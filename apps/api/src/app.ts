import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { and, desc, eq, sql, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { addOns, addonEvents, auditLogs, leads, memberships, notifications, plans, products, rolePermissions, roles, scoped, sessions, subscriptionEvents as subscriptionEventsTable, subscriptions, tenantAddOns, tenants, users, type Db } from '@codela/db';
import { SYSTEM_ROLES, applyEvent, startTrial } from '@codela/shared';
import { HttpError, badRequest, conflict, notFound } from './errors';
import { CSRF_COOKIE, SESSION_COOKIE, authenticate, requirePermission } from './auth';
import { csrfFor, hashPassword, newToken, sha256 } from './security';
import * as S from './schemas';
import { assertWithinLimit, assertWritable, effectiveLimits, getEntitlements, saveSub, usage } from './entitlements';
import { indexEntity, removeFromIndex, search } from './search';
import { z } from 'zod';
import { defaultResolveTxt, siteRouters, type ResolveTxt } from './site';
import { platformRouter } from './platform-admin';
import { dispatchQueued, outboxRouter, type Providers } from './outbox';
import { applyPaymentResult, billingRouters, resolveGateways, startCheckout, type ProviderChoice } from './billing';
import { getProduct } from './products/registry';
import { productPublicRouter, productTenantRouter } from './products/routes';
import { parseTrustProxy, type TrustProxySetting } from './trust-proxy';
import { providersFromEnv } from './providers/notify';
import { filesRouters } from './uploads';
import { manualPaymentTenantRouter } from './manual-payments';
import { portalRouter } from './portal';
import { customerPaymentPublicRouter, customerPaymentTenantRouter } from './customer-payments';
import { fleetDriverRoutes } from './fleet-driver';
import { ensureProductRole, syncRolePermissions } from './role-sync';
import { rolesRouter } from './roles';
import { activeAnnouncements } from './platform-extra';
import { grantAddOn } from './addon-lifecycle';
import { accountRecoveryRouter, sendVerification } from './account-recovery';
import { staffAvatarRouter } from './avatars';
import { monitor } from './monitoring';
import { deliveryWebhooks } from './delivery-webhooks';
import { gateUserLogin, twoFactorRouter } from './login-gate';
import { REPO_ROOT } from './env';
import path from 'node:path';

export interface AppOptions { globalRateLimitMax?: number; providers?: Providers; paymentProvider?: ProviderChoice; webhookSecrets?: Record<string, string>; trustProxy?: TrustProxySetting; uploadDir?: string; portalEmailVerification?: boolean; publicFormRateLimitMax?: number; rootDomain?: string; resolveTxt?: ResolveTxt; sandboxBilling?: boolean; db: Db; secureCookies?: boolean; csrfSecret?: string; authRateLimitMax?: number; sessionDays?: number ; staffEmailVerification?: boolean; publicUrl?: string }

const isUnique = (e: unknown) => /UNIQUE constraint failed/.test(String((e as Error)?.message));

export function createApp(opts: AppOptions) {
  const { db } = opts;
  const secure = opts.secureCookies ?? process.env.NODE_ENV === 'production';
  const csrfSecret = opts.csrfSecret ?? process.env.CSRF_SECRET ?? 'dev-only-csrf-secret-change-me';
  if (secure && csrfSecret.startsWith('dev-only')) throw new Error('CSRF_SECRET must be set in production');
  const sessionMs = (opts.sessionDays ?? 7) * 86_400_000;
  const providers: Providers = opts.providers ?? providersFromEnv(); // real adapters exist only when their credentials are set

  // Staff / owner account e-mails (verification, password reset). Links point at PUBLIC_WEB_URL when set, else at the host the request came through.
  const publicUrl = opts.publicUrl ?? (process.env.PUBLIC_WEB_URL || undefined);
  const staffVerify = opts.staffEmailVerification ?? (process.env.STAFF_EMAIL_VERIFICATION ? process.env.STAFF_EMAIL_VERIFICATION === '1' : secure);
  const requireStaffVerified = process.env.STAFF_REQUIRE_EMAIL_VERIFICATION === '1';
  const afterEnqueue = async (tenantId: string) => dispatchQueued(db, providers, tenantId);

  const app = express();
  app.disable('x-powered-by');
  // Never `true`: see trust-proxy.ts. Default = loopback only; production sets a hop count / proxy CIDRs.
  app.set('trust proxy', opts.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY));
  app.use(helmet());
  const gateways = resolveGateways(opts.paymentProvider, opts.webhookSecrets); const billing = billingRouters(db, gateways);
  app.use('/api/v1/webhooks', deliveryWebhooks(db)); // before the payment-gateway catch-all (`/:gateway`)
  app.use('/api/v1/webhooks', billing.webhook);
  app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: opts.globalRateLimitMax ?? 600, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: opts.authRateLimitMax ?? 30, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } } });

  function startSession(res: Response, userId: string, tenantId: string) {
    const token = newToken();
    const expires = new Date(Date.now() + sessionMs);
    db.insert(sessions).values({ tokenHash: sha256(token), userId, tenantId, scope: 'tenant', expiresAt: expires.toISOString() }).run();
    const csrf = csrfFor(token, csrfSecret);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, expires, path: '/' });
    res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'lax', secure, expires, path: '/' });
    return csrf;
  }
  const audit = (action: string, tenantId: string | null, actorId: string | null, entity?: string, entityId?: string) =>
    db.insert(auditLogs).values({ action, tenantId, actorId, entity, entityId }).run();

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  // Readiness: proves the database answers (use for load-balancer / uptime checks); /health only proves the process is up.
  api.get('/ready', (_req, res) => { try { db.get(sql`select 1 as ok`); res.json({ data: { status: 'ready' } }); } catch { res.status(503).json({ error: { code: 'NOT_READY', message: 'Database unavailable' } }); } });

  // ---- auth ----
  api.post('/auth/register-business', authLimiter, async (req, res, next) => {
    try {
      const b = S.registerBusiness.parse(req.body);
      const hash = await hashPassword(b.password);
      const result = db.transaction((tx) => {
        const tenant = tx.insert(tenants).values({ slug: b.slug, name: b.businessName, productSlug: b.productSlug,
          status: 'active', locale: b.locale, currency: b.currency }).returning().get();
        const roleIds: Record<string, string> = {};
        const prod_ = getProduct(b.productSlug);
        const extra: Record<string, string[]> = { owner: [], manager: (prod_?.entities ?? []).map((e) => `${e.module}.*`),
          employee: Object.entries(prod_?.employeeModules ?? {}).flatMap(([m, acts]) => acts.map((x) => `${m}.${x}`)) };
        for (const [name, perms] of Object.entries(SYSTEM_ROLES)) {
          const r = tx.insert(roles).values({ tenantId: tenant.id, name, isSystem: true }).returning().get();
          roleIds[name] = r.id;
          for (const p of new Set([...perms, ...(extra[name] ?? [])])) tx.insert(rolePermissions).values({ roleId: r.id, permission: p }).run();
        }
        for (const rn of Object.keys(prod_?.roles ?? {})) ensureProductRole(tx as unknown as Db, tenant.id, b.productSlug, rn);
        const user = tx.insert(users).values({ email: b.email, passwordHash: hash, name: b.name, locale: b.locale }).returning().get();
        tx.insert(memberships).values({ userId: user.id, tenantId: tenant.id, roleId: roleIds.owner }).run();
        const prod = tx.select().from(products).where(eq(products.slug, b.productSlug)).get();
        if (!prod || prod.status !== 'active') throw badRequest('This product is not available for subscription yet');
        const plan = tx.select().from(plans).where(and(eq(plans.productSlug, b.productSlug), eq(plans.tier, 'starter'))).get();
        if (!plan) throw badRequest('This product is not available for subscription yet');
        const trial = startTrial(new Date(), plan.trialDays, 'monthly');
        const sub = tx.insert(subscriptions).values({ tenantId: tenant.id, planId: plan.id, billingPeriod: trial.billingPeriod, status: trial.status, trialEndsAt: trial.trialEndsAt }).returning().get();
        tx.insert(notifications).values({ tenantId: tenant.id, type: 'welcome', title: 'Welcome to Codela', body: `Your ${plan.trialDays}-day trial has started.` }).run();
        return { tenant, user, subId: sub.id };
      });
      const csrfToken = startSession(res, result.user.id, result.tenant.id);
      if (staffVerify) sendVerification(db, { csrfSecret, afterEnqueue }, result.user, publicUrl ?? `${secure ? 'https' : req.protocol}://${req.get('x-forwarded-host') ?? req.get('host')}`);
      audit('tenant.registered', result.tenant.id, result.user.id, 'tenant', result.tenant.id);
      res.status(201).json({ data: { tenant: { id: result.tenant.id, slug: result.tenant.slug, name: result.tenant.name, productSlug: result.tenant.productSlug },
        user: { id: result.user.id, email: result.user.email, name: result.user.name }, csrfToken } });
    } catch (e) {
      if (isUnique(e)) {
        const m = String((e as Error).message); console.error('[register-business] unique violation:', m);   // shows which constraint really failed
        return next(conflict(/users\.email/.test(m) ? 'Email already registered' : /tenants\.slug/.test(m) ? 'Business address already taken' : 'Registration conflict (see API log)'));
      }
      next(e);
    }
  });

  api.post('/auth/login', authLimiter, async (req, res, next) => {
    try {
      const b = S.login.parse(req.body);
      const user = db.select().from(users).where(eq(users.email, b.email)).get();
      const fail = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      await gateUserLogin(db, user, b.password, b.otp);
      if (!user || user.status !== 'active') throw fail();
      if (requireStaffVerified && !user.emailVerifiedAt && !user.isPlatformStaff) throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Please confirm your e-mail first. Use the link we sent you, or request a new one.');
      const m = db.select({ tenantId: memberships.tenantId, slug: tenants.slug, name: tenants.name, tstatus: tenants.status }).from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active'))).get();
      if (!m) throw fail();
      if (m.tstatus === 'suspended') throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
      const csrfToken = startSession(res, user.id, m.tenantId);
      audit('auth.login', m.tenantId, user.id);
      res.json({ data: { user: { id: user.id, email: user.email, name: user.name }, tenant: { id: m.tenantId, slug: m.slug, name: m.name }, csrfToken } });
    } catch (e) { next(e); }
  });

  // ---- authenticated ----
  const authed = express.Router();

  authed.get('/auth/me', (req, res) => {
    const a = req.auth!;
    const user = db.select().from(users).where(eq(users.id, a.userId)).get()!;
    const tenant = db.select().from(tenants).where(eq(tenants.id, a.tenantId)).get()!;
    res.json({ data: { user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, productSlug: tenant.productSlug, currency: tenant.currency, locale: tenant.locale },
      role: a.roleName, permissions: a.permissions } });
  });
  authed.post('/auth/logout', (req, res) => {
    db.delete(sessions).where(eq(sessions.tokenHash, sha256(req.auth!.sessionToken))).run();
    res.clearCookie(SESSION_COOKIE); res.clearCookie(CSRF_COOKIE);
    res.json({ data: { ok: true } });
  });

  const indexCustomer = (tenantId: string, c: { id: string; name: string; ref: string; phone: string | null; email: string | null }) =>
    indexEntity(db, tenantId, { entityType: 'customer', entityId: c.id, title: c.name, subtitle: c.ref, terms: [c.ref, c.phone, c.email, c.id], permissionKey: 'customers.read' });
  const cust = express.Router();
  cust.get('/', requirePermission('customers.read'), (req, res) => res.json({ data: scoped(db, req.auth!.tenantId).customers.list() }));
  cust.get('/:id', requirePermission('customers.read'), (req, res, next) => {
    const c = scoped(db, req.auth!.tenantId).customers.get(String(req.params.id));
    if (c) res.json({ data: c }); else next(notFound('Customer not found'));
  });
  cust.post('/', requirePermission('customers.create'), (req, res, next) => {
    try {
      const body = S.customerCreate.parse(req.body);
      assertWithinLimit(db, req.auth!.tenantId, 'maxRecords');
      const row = scoped(db, req.auth!.tenantId).customers.insert(body);
      indexCustomer(req.auth!.tenantId, row);
      audit('customer.created', req.auth!.tenantId, req.auth!.userId, 'customer', row.id);
      res.status(201).json({ data: row });
    } catch (e) { next(isUnique(e) ? conflict('Customer reference already exists') : e); }
  });
  cust.patch('/:id', requirePermission('customers.update'), (req, res, next) => {
    try {
      const body = S.customerUpdate.parse(req.body);
      const s = scoped(db, req.auth!.tenantId).customers;
      if (Object.keys(body).length === 0) throw badRequest('No fields to update');
      if (s.update(String(req.params.id), body) === 0) throw notFound('Customer not found');
      audit('customer.updated', req.auth!.tenantId, req.auth!.userId, 'customer', String(req.params.id));
      const updated = s.get(String(req.params.id))!;
      indexCustomer(req.auth!.tenantId, updated);
      res.json({ data: updated });
    } catch (e) { next(isUnique(e) ? conflict('Customer reference already exists') : e); }
  });
  cust.delete('/:id', requirePermission('customers.delete'), (req, res, next) => {
    if (scoped(db, req.auth!.tenantId).customers.remove(String(req.params.id)) === 0) return next(notFound('Customer not found'));
    removeFromIndex(db, req.auth!.tenantId, 'customer', String(req.params.id));
    audit('customer.deleted', req.auth!.tenantId, req.auth!.userId, 'customer', String(req.params.id));
    res.json({ data: { ok: true } });
  });
  authed.use('/tenant/customers', cust);

  const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'USD', 'EUR'];
  const zones = new Set(Intl.supportedValuesOf('timeZone'));
  authed.get('/tenant/settings', requirePermission('tenant.settings'), (req, res) => {
    const t = db.select().from(tenants).where(eq(tenants.id, req.auth!.tenantId)).get()!;
    res.json({ data: { name: t.name, currency: t.currency, locale: t.locale, timezone: t.timezone, taxBp: t.taxBp, productSlug: t.productSlug, slug: t.slug, notifyPrefs: t.notifyPrefs } });
  });
  authed.patch('/tenant/settings', requirePermission('tenant.settings'), (req, res, next) => {
    try {
      const b = z.object({ name: z.string().trim().min(2).max(120), currency: z.enum(CURRENCIES as [string, ...string[]]), locale: z.enum(['ar', 'en']), taxBp: z.number().int().min(0).max(10000),
        timezone: z.string().refine((z_) => zones.has(z_), 'unknown time zone'),
        notifyPrefs: z.object({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), reminders: z.boolean(), orders: z.boolean() }).partial().strict() }).partial().strict().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('No fields to update');
      const tenantId = req.auth!.tenantId; const cur = db.select().from(tenants).where(eq(tenants.id, tenantId)).get()!;
      if (b.currency && b.currency !== cur.currency) {
        const hasData = (db.get(sql`select (select count(*) from records where tenant_id = ${tenantId}) + (select count(*) from customers where tenant_id = ${tenantId}) + (select count(*) from billing_invoices where tenant_id = ${tenantId}) as c`) as { c: number }).c > 0;
        if (hasData) throw new HttpError(409, 'CURRENCY_LOCKED', 'The currency cannot change once financial data exists');
      }
      db.update(tenants).set(b).where(eq(tenants.id, tenantId)).run(); audit('tenant.settings.updated', tenantId, req.auth!.userId, 'tenant', tenantId);
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  authed.get('/tenant/employees', requirePermission('employees.read'), (req, res) => {
    const rows = db.select({ id: users.id, name: users.name, email: users.email, role: roles.name, status: memberships.status, joinedAt: memberships.createdAt }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId)).innerJoin(roles, eq(roles.id, memberships.roleId)).where(eq(memberships.tenantId, req.auth!.tenantId)).all();
    res.json({ data: rows });
  });
  authed.patch('/tenant/employees/:id', requirePermission('employees.manage'), (req, res, next) => {
    try {
      const b = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body); const tenantId = req.auth!.tenantId; const id = String(req.params.id);
      const m = db.select({ mid: memberships.id, role: roles.name }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.userId, id), eq(memberships.tenantId, tenantId))).get();
      if (!m) throw notFound('Member not found');
      if (m.role === 'owner' || id === req.auth!.userId) throw conflict('The owner account cannot be suspended');
      db.update(memberships).set({ status: b.status }).where(eq(memberships.id, m.mid)).run();
      audit(`employee.${b.status}`, tenantId, req.auth!.userId, 'user', id); res.json({ data: { id, status: b.status } });
    } catch (e) { next(e); }
  });
  authed.use('/tenant', rolesRouter(db));
  authed.get('/tenant/announcements', (req, res) => res.json({ data: activeAnnouncements(db, tenantProductSlug(req.auth!.tenantId)) }));
  authed.post('/tenant/employees', requirePermission('employees.manage'), async (req, res, next) => {
    try {
      const b = S.employeeCreate.parse(req.body);
      const tenantId = req.auth!.tenantId;
      assertWithinLimit(db, tenantId, 'maxEmployees');
      const hash = await hashPassword(b.password);
      const out = db.transaction((tx) => {
        const role = ensureProductRole(tx as unknown as Db, tenantId, tenantProductSlug(tenantId), b.role);
        if (!role) throw badRequest('Unknown role');
        const user = tx.insert(users).values({ email: b.email, passwordHash: hash, name: b.name }).returning().get();
        tx.insert(memberships).values({ userId: user.id, tenantId, roleId: role.id }).run();
        return user;
      });
      audit('employee.created', tenantId, req.auth!.userId, 'user', out.id);
      res.status(201).json({ data: { id: out.id, email: out.email, name: out.name, role: b.role } });
    } catch (e) { next(isUnique(e) ? conflict('Email already registered') : e); }
  });


  const site = siteRouters(db, { rootDomain: opts.rootDomain ?? process.env.ROOT_DOMAIN ?? 'localhost', resolveTxt: opts.resolveTxt ?? defaultResolveTxt });
  const formLimiter = rateLimit({ windowMs: 15 * 60_000, limit: opts.publicFormRateLimitMax ?? 20, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } } });
  site.pub.post('/leads', formLimiter, (req, res, next) => {
    try {
      const b = z.object({ kind: z.enum(['demo_request', 'contact']), name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email().optional(),
        phone: z.string().trim().max(30).optional(), company: z.string().trim().max(200).optional(), productSlug: z.string().max(40).optional(),
        message: z.string().max(2000).optional(), website: z.string().max(500).optional() })
        .refine((v) => v.email || v.phone, { message: 'email or phone is required' }).parse(req.body);
      if (!b.website) { // honeypot: bots fill the hidden field; respond OK but store nothing
        db.insert(leads).values({ name: b.name, email: b.email, phone: b.phone, company: b.company, productSlug: b.productSlug, message: b.message, source: b.kind }).run();
      }
      res.status(201).json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  site.pub.get('/products', (_req, res) => res.json({ data: db.select({ slug: products.slug, nameAr: products.nameAr, nameEn: products.nameEn }).from(products).where(eq(products.status, 'active')).all() }));
  site.pub.get('/plans', (req, res, next) => {
    try {
      const { productSlug } = z.object({ productSlug: z.string().min(1).max(40) }).parse(req.query);
      const prod = db.select().from(products).where(eq(products.slug, productSlug)).get();
      const rows = prod?.status === 'active' ? db.select().from(plans).where(and(eq(plans.productSlug, productSlug), eq(plans.active, true))).all() : [];
      const order = ['starter', 'professional', 'business'];
      res.json({ data: rows.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier)).map((p) => ({ id: p.id, tier: p.tier, nameAr: p.nameAr, nameEn: p.nameEn, priceMonthly: p.priceMonthly, priceAnnual: p.priceAnnual, currency: p.currency, trialDays: p.trialDays, limits: p.limits })) });
    } catch (e) { next(e); }
  });
  api.use('/public', productPublicRouter(db, site.resolveTenant, formLimiter, async (tenantId) => dispatchQueued(db, providers, tenantId)));
  const uploadDir = opts.uploadDir ?? (process.env.UPLOAD_DIR ? path.resolve(REPO_ROOT, process.env.UPLOAD_DIR) : path.join(REPO_ROOT, 'data', 'uploads'));
  const fr = filesRouters(db, { uploadDir });
  api.use(accountRecoveryRouter(db, { secure, csrfSecret, limiter: authLimiter, publicUrl, afterEnqueue }));
  api.use('/public', portalRouter(db, { secure, csrfSecret, sessionMs, limiter: authLimiter, resolveTenant: site.resolveTenant,
    requireEmailVerification: opts.portalEmailVerification ?? (process.env.PORTAL_REQUIRE_EMAIL_VERIFICATION ? process.env.PORTAL_REQUIRE_EMAIL_VERIFICATION === '1' : secure),
    afterEnqueue: async (tenantId) => dispatchQueued(db, providers, tenantId), uploadDir }));
  api.use('/public', fr.pub);
  api.use('/public', customerPaymentPublicRouter(db, { uploadDir, limiter: authLimiter, resolveTenant: site.resolveTenant }));
  api.use('/public', site.pub);
  authed.use('/auth/2fa', twoFactorRouter(db, (req) => req.auth!.userId));
  authed.use(fr.authed);
  authed.use(staffAvatarRouter(db, uploadDir));
  authed.use(site.authed);
  authed.use(billing.authed);
  authed.use(manualPaymentTenantRouter(db, { uploadDir }));
  authed.use(customerPaymentTenantRouter(db, { uploadDir }));
  fleetDriverRoutes(authed, db, { uploadDir, hashPassword, assertWithinLimit, audit, isUnique });
  authed.use(outboxRouter(db, providers));
  authed.use('/tenant', productTenantRouter(db));

  // ---- subscription ----
  const subView = (tenantId: string) => {
    const e = getEntitlements(db, tenantId);
    return { ...e.sub, plan: { id: e.plan.id, tier: e.plan.tier, nameAr: e.plan.nameAr, nameEn: e.plan.nameEn,
      priceMonthly: e.plan.priceMonthly, priceAnnual: e.plan.priceAnnual, currency: e.plan.currency }, limits: e.limits, usage: e.usage, access: e.access, paymentMode: gateways.active?.name ?? 'manual' };
  };
  authed.get('/tenant/subscription', (req, res) => res.json({ data: subView(req.auth!.tenantId) }));
  authed.post('/tenant/subscription/activate', requirePermission('subscription.manage'), async (req, res, next) => {
    try {
      if (gateways.active?.name !== 'sandbox') throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', 'No payment gateway is configured');
      const b = z.object({ billingPeriod: z.enum(['monthly', 'annual']) }).parse(req.body);
      const r = await startCheckout(db, gateways.active, req.auth!.tenantId, b.billingPeriod); applyPaymentResult(db, r.tx.id, 'succeeded');
      audit('subscription.activated.simulated', req.auth!.tenantId, req.auth!.userId);
      res.json({ data: { ...subView(req.auth!.tenantId), simulated: true } });
    } catch (e) { next(e); }
  });
  authed.post('/tenant/subscription/cancel', requirePermission('subscription.manage'), (req, res, next) => {
    try {
      const b = z.object({ atPeriodEnd: z.boolean().default(true) }).parse(req.body);
      const e = getEntitlements(db, req.auth!.tenantId);
      let n; try { n = applyEvent(e.sub, { type: 'cancel', atPeriodEnd: b.atPeriodEnd }, new Date()); } catch { throw conflict('Subscription cannot be canceled in its current state'); }
      saveSub(db, e.subscriptionId, req.auth!.tenantId, n, 'cancel_requested', e.sub.status, { atPeriodEnd: b.atPeriodEnd });
      audit('subscription.canceled', req.auth!.tenantId, req.auth!.userId);
      res.json({ data: subView(req.auth!.tenantId) });
    } catch (e) { next(e); }
  });
  authed.post('/tenant/subscription/change-plan', requirePermission('subscription.manage'), (req, res, next) => {
    try {
      const b = z.object({ tier: z.enum(['starter', 'professional', 'business']) }).parse(req.body);
      const tenantId = req.auth!.tenantId;
      const e = getEntitlements(db, tenantId);
      if (e.access !== 'full') throw new HttpError(402, 'SUBSCRIPTION_INACTIVE', 'Activate your subscription first');
      const target = db.select().from(plans).where(and(eq(plans.productSlug, tenantProductSlug(tenantId)), eq(plans.tier, b.tier), eq(plans.active, true))).get();
      if (!target) throw notFound('Plan not found');
      // A higher tier on an already-paid subscription must not take effect without payment (no proration/charge is wired to a real gateway yet).
      const TIER = { starter: 0, professional: 1, business: 2 } as const;
      if (TIER[b.tier] > TIER[e.plan.tier as keyof typeof TIER] && e.sub.status !== 'trialing' && gateways.active?.name !== 'sandbox')
        throw new HttpError(402, 'UPGRADE_REQUIRES_PAYMENT', 'Upgrading a paid plan requires payment. Contact support to upgrade.');
      const lim = effectiveLimits(db, tenantId, target.limits); const u = usage(db, tenantId);
      for (const k of ['maxEmployees', 'maxRecords'] as const)
        if (typeof lim[k] === 'number' && u[k] > (lim[k] as number)) throw new HttpError(409, 'DOWNGRADE_BLOCKED', `Current usage of ${k} (${u[k]}) exceeds the ${b.tier} limit (${lim[k]})`);
      db.update(subscriptions).set({ planId: target.id }).where(eq(subscriptions.tenantId, tenantId)).run();
      db.insert(subscriptionEventsTable).values({ tenantId, subscriptionId: e.subscriptionId, type: 'plan_changed', fromStatus: e.sub.status, toStatus: e.sub.status, meta: { from: e.plan.tier, to: b.tier } }).run();
      audit('subscription.plan_changed', tenantId, req.auth!.userId);
      res.json({ data: subView(tenantId) });
    } catch (e) { next(e); }
  });

  // ---- add-ons ----
  const tenantProductSlug = (tenantId: string) => db.select({ p: tenants.productSlug }).from(tenants).where(eq(tenants.id, tenantId)).get()!.p;
  syncRolePermissions(db); // existing tenants receive the permissions of modules / job roles added after they registered (additive only)
  const compatibleAddOn = (tenantId: string, key: string) => {
    const a = db.select().from(addOns).where(and(eq(addOns.key, key), eq(addOns.active, true))).get();
    if (!a) return undefined;
    return a.compatibleProducts === '*' || a.compatibleProducts.includes(tenantProductSlug(tenantId)) ? a : undefined;
  };
  authed.get('/tenant/addons', requirePermission('subscription.manage'), (req, res) => {
    const tenantId = req.auth!.tenantId;
    const mine = new Map(db.select().from(tenantAddOns).where(eq(tenantAddOns.tenantId, tenantId)).all().map((r) => [r.addOnKey, r]));
    const all = db.select().from(addOns).where(eq(addOns.active, true)).all()
      .filter((a) => a.compatibleProducts === '*' || a.compatibleProducts.includes(tenantProductSlug(tenantId)));
    res.json({ data: all.map((a) => ({ key: a.key, nameAr: a.nameAr, nameEn: a.nameEn, description: a.description, priceMinor: a.priceMinor,
      currency: a.currency, billingType: a.billingType, status: mine.get(a.key)?.status ?? 'available', expiresAt: mine.get(a.key)?.expiresAt ?? null })) });
  });
  authed.post('/tenant/addons/:key/activate', requirePermission('subscription.manage'), (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId; const key = String(req.params.key);
      // Add-on charging is not wired to a real gateway yet: outside sandbox mode an add-on must not be granted for free.
      if (gateways.active?.name !== 'sandbox') throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', 'Add-on billing is not connected yet. Contact support to enable this add-on.');
      if (!compatibleAddOn(tenantId, key)) throw notFound('Add-on not available for your product');
      const ex = db.select().from(tenantAddOns).where(and(eq(tenantAddOns.tenantId, tenantId), eq(tenantAddOns.addOnKey, key))).get();
      if (ex?.status === 'active') throw conflict('Add-on already active');
      grantAddOn(db, tenantId, compatibleAddOn(tenantId, key)!, new Date(), 'sandbox');
      audit('addon.activated.simulated', tenantId, req.auth!.userId, 'addon', key);
      res.json({ data: { key, status: 'active', simulated: true } });
    } catch (e) { next(e); }
  });
  authed.post('/tenant/addons/:key/cancel', requirePermission('subscription.manage'), (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId; const key = String(req.params.key);
      const ex = db.select().from(tenantAddOns).where(and(eq(tenantAddOns.tenantId, tenantId), eq(tenantAddOns.addOnKey, key), inArray(tenantAddOns.status, ['active', 'renewal_due']))).get();
      if (!ex) throw notFound('Add-on is not active');
      db.update(tenantAddOns).set({ status: 'canceled', endedAt: new Date().toISOString() }).where(eq(tenantAddOns.id, ex.id)).run(); db.insert(addonEvents).values({ tenantId, addOnKey: key, action: 'canceled' }).run();
      audit('addon.canceled', tenantId, req.auth!.userId, 'addon', key);
      res.json({ data: { key, status: 'canceled' } });
    } catch (e) { next(e); }
  });

  // ---- global search ----
  authed.get('/search', requirePermission('search.use'), (req, res, next) => {
    try {
      const q = z.object({ q: z.string().trim().min(1).max(100), page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20), type: z.string().max(40).optional() }).parse(req.query);
      const r = search(db, req.auth!.tenantId, req.auth!.permissions, { q: q.q, page: q.page, pageSize: q.pageSize, entityType: q.type });
      res.json({ data: r.rows, meta: { total: r.total, page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });

  // ---- notifications ----
  authed.get('/tenant/notifications', (req, res) => {
    const rows = db.select().from(notifications).where(and(eq(notifications.tenantId, req.auth!.tenantId))).orderBy(desc(notifications.createdAt)).limit(100).all()
      .filter((n) => n.userId === null || n.userId === req.auth!.userId);
    res.json({ data: rows });
  });
  authed.post('/tenant/notifications/:id/read', (req, res, next) => {
    const r = db.update(notifications).set({ readAt: new Date().toISOString() })
      .where(and(eq(notifications.id, String(req.params.id)), eq(notifications.tenantId, req.auth!.tenantId))).run();
    if (r.changes) res.json({ data: { ok: true } }); else next(notFound('Notification not found'));
  });

  api.use('/platform', platformRouter(db, { secure, csrfSecret, sessionMs, authLimiter, uploadDir }));
  api.use(['/auth/me', '/auth/logout', '/auth/2fa', '/tenant', '/search'], authenticate(db, csrfSecret));
  // Lapsed subscriptions are read-only: writes blocked (402) except billing + notification routes. Data is never deleted.
  api.use('/tenant', (req, _res, next) => {
    try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !/^\/(subscription|notifications)(\/|$)/.test(req.path)) assertWritable(db, req.auth!.tenantId);
      next();
    } catch (e) { next(e); }
  });
  api.use(authed);
  api.use((_req, _res, next) => next(notFound('Route not found')));
  app.use('/api/v1', api);
  app.use((_req, _res, next) => next(notFound('Route not found')));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const i of err.issues) (fields[i.path.join('.') || '_'] ??= []).push(i.message);
      return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', fields } });
    }
    if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    if ((err as { type?: string })?.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Request body is too large' } });
    if ((err as { type?: string })?.type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON' } });
    console.error('[api] unhandled error', req.method, req.path, (err as Error)?.message);
    void monitor.capture(err, { method: req.method, path: req.path }); // no-op unless SENTRY_DSN is set; sends no headers, cookies or bodies
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
  return app;
}
