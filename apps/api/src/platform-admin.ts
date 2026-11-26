import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { and, count, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { addOns, auditLogs, billingInvoices, paymentTransactions, internalTasks, leads, platformSettings, plans, platformStaff, products, sessions, subscriptions, tenants, users, type Db } from '@codela/db';
import { PLATFORM_DEPARTMENTS, PLATFORM_ROLES, hasPermission } from '@codela/shared';
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized } from './errors';
import { csrfFor, hashPassword, newToken, safeEqual, sha256 } from './security';
import { mountPlatformExtras } from './platform-extra';
import { gateUserLogin, twoFactorRouter } from './login-gate';
import { password } from './schemas';
import { getEntitlements } from './entitlements';
import { registerManualPaymentReview } from './manual-payments';

export const PLATFORM_COOKIE = 'psid';
export const PLATFORM_CSRF_COOKIE = 'pcsrf';
declare module 'express-serve-static-core' { interface Request { platform?: { userId: string; role: string; permissions: string[]; sessionToken: string } } }

const staffInput = z.object({ email: z.string().trim().toLowerCase().email(), password, name: z.string().trim().min(2).max(120),
  role: z.enum(Object.keys(PLATFORM_ROLES) as [string, ...string[]]), department: z.enum(PLATFORM_DEPARTMENTS) });
export type StaffInput = z.input<typeof staffInput>;

/** Creates an internal Codela staff account (also used by the CLI). Never exposed to tenants. */
export async function createPlatformStaff(db: Db, input: StaffInput) {
  const b = staffInput.parse(input);
  const hash = await hashPassword(b.password);
  return db.transaction((tx) => {
    const u = tx.insert(users).values({ email: b.email, passwordHash: hash, name: b.name, isPlatformStaff: true }).returning().get();
    tx.insert(platformStaff).values({ userId: u.id, roleName: b.role, department: b.department }).run();
    return { id: u.id, email: u.email, name: u.name, role: b.role, department: b.department };
  });
}

const isUnique = (e: unknown) => /UNIQUE constraint failed/.test(String((e as Error)?.message));
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const esc = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export function platformRouter(db: Db, o: { secure: boolean; csrfSecret: string; sessionMs: number; authLimiter: express.RequestHandler; uploadDir?: string }) {
  const r = Router();
  const audit = (req: Request, action: string, entity?: string, entityId?: string, meta?: Record<string, unknown>) =>
    db.insert(auditLogs).values({ action, actorId: req.platform?.userId ?? null, tenantId: null, entity, entityId, meta }).run();

  r.post('/auth/login', o.authLimiter, async (req, res, next) => {
    try {
      const b = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128), otp: z.string().trim().max(10).optional() }).parse(req.body);
      const u = db.select().from(users).where(eq(users.email, b.email)).get();
      const st = u && db.select().from(platformStaff).where(eq(platformStaff.userId, u.id)).get();
      // Only platform staff go through the gate (lock-out / 2FA counters); other accounts get the same generic failure after a dummy hash check.
      await gateUserLogin(db, u && st && u.isPlatformStaff ? u : undefined, b.password, b.otp);
      if (!u || !st || !u.isPlatformStaff || u.status !== 'active') throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      const token = newToken(); const expires = new Date(Date.now() + Math.min(o.sessionMs, 12 * 3_600_000)); // staff sessions are shorter
      db.insert(sessions).values({ tokenHash: sha256(token), userId: u.id, tenantId: null, scope: 'platform', expiresAt: expires.toISOString() }).run();
      const csrf = csrfFor(token, o.csrfSecret);
      res.cookie(PLATFORM_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: o.secure, expires, path: '/' });
      res.cookie(PLATFORM_CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'strict', secure: o.secure, expires, path: '/' });
      db.insert(auditLogs).values({ action: 'platform.login', actorId: u.id }).run();
      res.json({ data: { user: { id: u.id, email: u.email, name: u.name }, role: st.roleName, csrfToken: csrf } });
    } catch (e) { next(e); }
  });

  const auth = (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[PLATFORM_COOKIE] as string | undefined; if (!token) throw unauthorized();
      const row = db.select({ userId: sessions.userId, exp: sessions.expiresAt, scope: sessions.scope, status: users.status, role: platformStaff.roleName })
        .from(sessions).innerJoin(users, eq(users.id, sessions.userId)).innerJoin(platformStaff, eq(platformStaff.userId, users.id))
        .where(eq(sessions.tokenHash, sha256(token))).get();
      if (!row || row.scope !== 'platform' || row.exp <= new Date().toISOString() || row.status !== 'active') throw unauthorized();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const h = req.get('x-csrf-token') ?? ''; const c = (req.cookies?.[PLATFORM_CSRF_COOKIE] as string | undefined) ?? ''; const exp = csrfFor(token, o.csrfSecret);
        if (!h || !safeEqual(h, exp) || !safeEqual(c, exp)) throw forbidden('Invalid CSRF token');
      }
      req.platform = { userId: row.userId, role: row.role, permissions: [...(PLATFORM_ROLES[row.role as keyof typeof PLATFORM_ROLES] ?? [])], sessionToken: token };
      next();
    } catch (e) { next(e); }
  };
  const need = (perm: string) => (req: Request, _res: Response, next: NextFunction) =>
    hasPermission(req.platform!.permissions, perm) ? next() : next(forbidden());
  r.use(auth);
  r.use('/auth/2fa', twoFactorRouter(db, (req) => req.platform!.userId, 'Codela Admin'));

  registerManualPaymentReview(r, db, { need, audit, uploadDir: o.uploadDir ?? '' });

  r.get('/me', (req, res) => res.json({ data: { userId: req.platform!.userId, role: req.platform!.role, permissions: req.platform!.permissions } }));
  r.post('/auth/logout', (req, res) => { db.delete(sessions).where(eq(sessions.tokenHash, sha256(req.platform!.sessionToken))).run(); res.clearCookie(PLATFORM_COOKIE); res.clearCookie(PLATFORM_CSRF_COOKIE); res.json({ data: { ok: true } }); });

  // ---- tenants ----
  r.get('/tenants', need('tenants.read'), (req, res, next) => {
    try {
      const q = page.extend({ q: z.string().trim().max(100).optional(), product: z.string().optional(), status: z.string().optional(), subscription: z.string().optional() }).parse(req.query);
      const like_ = q.q ? or(sql`${tenants.name} like ${'%' + esc(q.q) + '%'} escape '\\'`, sql`${tenants.slug} like ${'%' + esc(q.q) + '%'} escape '\\'`, eq(tenants.id, q.q)) : undefined;
      const where = and(like_, q.product ? eq(tenants.productSlug, q.product) : undefined, q.status ? eq(tenants.status, q.status) : undefined, q.subscription ? eq(subscriptions.status, q.subscription) : undefined);
      const base = db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name, productSlug: tenants.productSlug, status: tenants.status, createdAt: tenants.createdAt,
        subscriptionStatus: subscriptions.status, planTier: plans.tier }).from(tenants).leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id)).leftJoin(plans, eq(plans.id, subscriptions.planId)).where(where);
      const total = db.select({ c: count() }).from(tenants).leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id)).where(where).get()!.c;
      const rows = base.orderBy(desc(tenants.createdAt), desc(tenants.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all();
      res.json({ data: rows, meta: { total, page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });
  r.get('/tenants/:id', need('tenants.read'), (req, res, next) => {
    const t = db.select().from(tenants).where(eq(tenants.id, String(req.params.id))).get(); if (!t) return next(notFound('Tenant not found'));
    const e = getEntitlements(db, t.id);
    res.json({ data: { tenant: t, subscription: { ...e.sub, plan: { id: e.plan.id, tier: e.plan.tier } }, limits: e.limits, usage: e.usage } });
  });
  r.patch('/tenants/:id/status', need('tenants.manage'), (req, res, next) => {
    try {
      const b = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
      const id = String(req.params.id);
      const ch = db.update(tenants).set({ status: b.status }).where(and(eq(tenants.id, id), sql`${tenants.status} != 'closed'`)).run().changes;
      if (!ch) throw notFound('Tenant not found');
      audit(req, 'platform.tenant.status_changed', 'tenant', id, { status: b.status });
      res.json({ data: { id, status: b.status } });
    } catch (e) { next(e); }
  });

  // ---- products / plans / add-ons ----
  r.get('/products', need('revenue.read'), (_req, res) => res.json({ data: db.select().from(products).all() }));
  r.patch('/products/:slug', need('products.manage'), (req, res, next) => {
    try {
      const b = z.object({ status: z.enum(['active', 'inactive']).optional(), nameAr: z.string().min(1).max(120).optional(), nameEn: z.string().min(1).max(120).optional() }).strict().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('No fields to update');
      if (!db.update(products).set(b).where(eq(products.slug, String(req.params.slug))).run().changes) throw notFound('Product not found');
      audit(req, 'platform.product.updated', 'product', String(req.params.slug), b); res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  r.get('/plans', need('revenue.read'), (req, res) => {
    const p = typeof req.query.productSlug === 'string' ? req.query.productSlug : undefined;
    res.json({ data: db.select().from(plans).where(p ? eq(plans.productSlug, p) : undefined).all() });
  });
  r.patch('/plans/:id', need('plans.manage'), (req, res, next) => {
    try {
      const b = z.object({ priceMonthly: z.number().int().min(0).optional(), priceAnnual: z.number().int().min(0).optional(), trialDays: z.number().int().min(0).max(365).optional(),
        limits: z.record(z.string(), z.union([z.number().int().min(0), z.boolean()])).optional(), active: z.boolean().optional(), nameAr: z.string().min(1).max(80).optional(), nameEn: z.string().min(1).max(80).optional() }).strict().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('No fields to update');
      if (!db.update(plans).set(b).where(eq(plans.id, String(req.params.id))).run().changes) throw notFound('Plan not found');
      audit(req, 'platform.plan.updated', 'plan', String(req.params.id), b); res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  const addOnBody = z.object({ nameAr: z.string().min(1).max(120), nameEn: z.string().min(1).max(120), description: z.string().max(500).default(''), priceMinor: z.number().int().min(0),
    currency: z.string().length(3).toUpperCase().default('EGP'), billingType: z.enum(['recurring', 'one_time']),
    compatibleProducts: z.union([z.literal('*'), z.array(z.string()).min(1)]), grants: z.record(z.string(), z.union([z.number().int(), z.boolean()])).default({}), active: z.boolean().default(true) });
  r.get('/addons', need('revenue.read'), (_req, res) => res.json({ data: db.select().from(addOns).all() }));
  r.post('/addons', need('plans.manage'), (req, res, next) => {
    try {
      const b = addOnBody.extend({ key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/) }).parse(req.body);
      db.insert(addOns).values(b).run(); audit(req, 'platform.addon.created', 'addon', b.key); res.status(201).json({ data: { key: b.key } });
    } catch (e) { next(isUnique(e) ? conflict('Add-on key already exists') : e); }
  });
  r.patch('/addons/:key', need('plans.manage'), (req, res, next) => {
    try {
      const b = addOnBody.partial().strict().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('No fields to update');
      if (!db.update(addOns).set(b).where(eq(addOns.key, String(req.params.key))).run().changes) throw notFound('Add-on not found');
      audit(req, 'platform.addon.updated', 'addon', String(req.params.key), b); res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  // ---- analytics (computed from subscription records; integer math only) ----
  r.get('/analytics', need('revenue.read'), (_req, res) => {
    const rows = db.select({ status: subscriptions.status, period: subscriptions.billingPeriod, product: tenants.productSlug, tier: plans.tier,
      pm: plans.priceMonthly, pa: plans.priceAnnual, cur: plans.currency }).from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId)).innerJoin(tenants, eq(tenants.id, subscriptions.tenantId)).all();
    const statuses = ['trialing', 'active', 'past_due', 'suspended', 'expired', 'canceled'] as const;
    const subs = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<string, number>;
    const revenue: Record<string, { mrr: number; arr: number }> = {};
    const byProduct: Record<string, Record<string, { mrr: number; arr: number; count: number }>> = {};
    const byPlan: Record<string, { count: number }> = {};
    for (const x of rows) {
      subs[x.status] = (subs[x.status] ?? 0) + 1;
      if (['trialing', 'active', 'past_due'].includes(x.status)) (byPlan[x.tier] ??= { count: 0 }).count++;
      if (x.status !== 'active') continue;
      const mrr = x.period === 'annual' ? Math.round(x.pa / 12) : x.pm;
      const arr = x.period === 'annual' ? x.pa : x.pm * 12;
      const t = (revenue[x.cur] ??= { mrr: 0, arr: 0 }); t.mrr += mrr; t.arr += arr;
      const p = ((byProduct[x.product] ??= {})[x.cur] ??= { mrr: 0, arr: 0, count: 0 }); p.mrr += mrr; p.arr += arr; p.count++;
    }
    const tt = db.select({ s: tenants.status, c: count() }).from(tenants).groupBy(tenants.status).all();
    const total = tt.reduce((a, b) => a + b.c, 0);
    const simulated = (db.get(sql`select count(*) as c from subscription_events where json_extract(meta,'$.simulated') = 1`) as { c: number }).c > 0;
    const collected: Record<string, { real: number; simulated: number }> = {};
    for (const x of db.select({ cur: paymentTransactions.currency, sim: paymentTransactions.simulated, amt: paymentTransactions.amount }).from(paymentTransactions).where(eq(paymentTransactions.status, 'succeeded')).all()) { const c = (collected[x.cur] ??= { real: 0, simulated: 0 }); c[x.sim ? 'simulated' : 'real'] += x.amt; }
    const failedPayments = db.select({ c: count() }).from(paymentTransactions).where(eq(paymentTransactions.status, 'failed')).get()!.c;
    const outstandingInvoices = db.select({ c: count() }).from(billingInvoices).where(eq(billingInvoices.status, 'issued')).get()!.c;
    res.json({ data: { collected, failedPayments, outstandingInvoices, tenants: { total, active: tt.find((x) => x.s === 'active')?.c ?? 0, suspended: tt.find((x) => x.s === 'suspended')?.c ?? 0 },
      subscriptions: subs, revenue, byProduct, byPlan, churn: { canceled: subs.canceled }, revenueBasis: 'subscription_records', simulated: simulated || Object.values(collected).some((c) => c.simulated > 0) } });
  });

  // ---- sales pipeline ----
  const STAGES = ['new', 'contacted', 'demo_scheduled', 'proposal', 'won', 'lost'] as const;
  const isStaff = (id: string) => !!db.select().from(platformStaff).where(eq(platformStaff.userId, id)).get();
  const leadFields = { name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email().nullish(), phone: z.string().trim().max(30).nullish(),
    company: z.string().trim().max(200).nullish(), productSlug: z.string().max(40).nullish(), message: z.string().max(2000).nullish(), notes: z.string().max(4000).nullish() };
  r.get('/leads/pipeline', need('sales.read'), (_req, res) => {
    const rows = db.select({ s: leads.stage, c: count() }).from(leads).groupBy(leads.stage).all();
    const stages = Object.fromEntries(STAGES.map((s) => [s, rows.find((x) => x.s === s)?.c ?? 0])) as Record<string, number>;
    const closed = stages.won + stages.lost;
    res.json({ data: { stages, total: Object.values(stages).reduce((a, b) => a + b, 0), conversionRate: closed ? stages.won / closed : null } });
  });
  r.get('/leads', need('sales.read'), (req, res, next) => {
    try {
      const q = page.extend({ q: z.string().trim().max(100).optional(), stage: z.enum(STAGES).optional(), source: z.string().optional(), product: z.string().optional() }).parse(req.query);
      const t = q.q ? `%${esc(q.q)}%` : null;
      const where = and(t ? or(sql`${leads.name} like ${t} escape '\\'`, sql`${leads.email} like ${t} escape '\\'`, sql`${leads.phone} like ${t} escape '\\'`, sql`${leads.company} like ${t} escape '\\'`) : undefined,
        q.stage ? eq(leads.stage, q.stage) : undefined, q.source ? eq(leads.source, q.source) : undefined, q.product ? eq(leads.productSlug, q.product) : undefined);
      const total = db.select({ c: count() }).from(leads).where(where).get()!.c;
      const rows = db.select().from(leads).where(where).orderBy(desc(leads.createdAt), desc(leads.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all();
      res.json({ data: rows, meta: { total, page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });
  r.post('/leads', need('sales.manage'), (req, res, next) => {
    try {
      const b = z.object(leadFields).strict().parse(req.body);
      const row = db.insert(leads).values({ ...b, source: 'manual' }).returning().get();
      audit(req, 'platform.lead.created', 'lead', row.id); res.status(201).json({ data: row });
    } catch (e) { next(e); }
  });
  r.patch('/leads/:id', need('sales.manage'), (req, res, next) => {
    try {
      const b = z.object({ ...leadFields, stage: z.enum(STAGES), ownerId: z.string().nullable() }).partial().strict().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('No fields to update');
      if (b.ownerId && !isStaff(b.ownerId)) throw badRequest('Owner must be a Codela staff member');
      const id = String(req.params.id);
      if (!db.update(leads).set({ ...b, updatedAt: new Date().toISOString() }).where(eq(leads.id, id)).run().changes) throw notFound('Lead not found');
      audit(req, 'platform.lead.updated', 'lead', id, b);
      res.json({ data: db.select().from(leads).where(eq(leads.id, id)).get() });
    } catch (e) { next(e); }
  });

  // ---- internal tasks (departments) ----
  const TASK_STATUS = ['todo', 'doing', 'done'] as const;
  r.get('/tasks', (req, res, next) => {
    try {
      const q = page.extend({ department: z.enum(PLATFORM_DEPARTMENTS).optional(), status: z.enum(TASK_STATUS).optional(), assigneeId: z.string().optional() }).parse(req.query);
      const where = and(q.department ? eq(internalTasks.department, q.department) : undefined, q.status ? eq(internalTasks.status, q.status) : undefined, q.assigneeId ? eq(internalTasks.assigneeId, q.assigneeId) : undefined);
      res.json({ data: db.select().from(internalTasks).where(where).orderBy(desc(internalTasks.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all(), meta: { page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });
  const taskFields = { title: z.string().trim().min(1).max(200), description: z.string().max(4000).nullish(), department: z.enum(PLATFORM_DEPARTMENTS),
    assigneeId: z.string().nullable(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), status: z.enum(TASK_STATUS) };
  r.post('/tasks', need('tasks.manage'), (req, res, next) => {
    try {
      const b = z.object({ ...taskFields, assigneeId: taskFields.assigneeId.optional(), dueDate: taskFields.dueDate.optional(), status: taskFields.status.optional() }).strict().parse(req.body);
      if (b.assigneeId && !isStaff(b.assigneeId)) throw badRequest('Assignee must be a Codela staff member');
      const row = db.insert(internalTasks).values({ ...b, createdBy: req.platform!.userId }).returning().get();
      audit(req, 'platform.task.created', 'task', row.id); res.status(201).json({ data: row });
    } catch (e) { next(e); }
  });
  r.patch('/tasks/:id', need('tasks.manage'), (req, res, next) => {
    try {
      const b = z.object(taskFields).partial().strict().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('No fields to update');
      if (b.assigneeId && !isStaff(b.assigneeId)) throw badRequest('Assignee must be a Codela staff member');
      const id = String(req.params.id);
      if (!db.update(internalTasks).set(b).where(eq(internalTasks.id, id)).run().changes) throw notFound('Task not found');
      res.json({ data: db.select().from(internalTasks).where(eq(internalTasks.id, id)).get() });
    } catch (e) { next(e); }
  });

  // ---- platform settings (never store secrets here) ----
  const SETTING_KEYS = ['company', 'currencies', 'localization', 'payment', 'notifications', 'integrations'];
  const hasSecret = (v: unknown): boolean => v !== null && typeof v === 'object' && Object.entries(v as object).some(([k, x]) => /secret|password|token|api[-_]?key|private/i.test(k) || hasSecret(x));
  r.get('/settings/:key', need('revenue.read'), (req, res, next) => {
    const key = String(req.params.key); if (!SETTING_KEYS.includes(key)) return next(notFound('Unknown setting'));
    res.json({ data: { key, value: db.select().from(platformSettings).where(eq(platformSettings.key, key)).get()?.value ?? {} } });
  });
  r.put('/settings/:key', need('settings.manage'), (req, res, next) => {
    try {
      const key = String(req.params.key); if (!SETTING_KEYS.includes(key)) throw badRequest('Unknown setting key');
      const { value } = z.object({ value: z.record(z.string(), z.unknown()) }).parse(req.body);
      if (hasSecret(value)) throw badRequest('Secrets/credentials must be provided via environment variables, not settings');
      if (key === 'payment') { // enabled methods must have a usable destination; values are normalised and bounded
        const v = value as Record<string, any>; const wallet = v.vodafone_cash; const ip = v.instapay;
        if (wallet && typeof wallet === 'object') { const n = String(wallet.number ?? '').replace(/[\s-]/g, ''); wallet.number = n; if (wallet.enabled === true && !/^01[0125]\d{8}$/.test(n)) throw badRequest('Vodafone Cash number must be an Egyptian mobile number (01XXXXXXXXX)'); }
        if (ip && typeof ip === 'object') { const h = String(ip.handle ?? '').trim(); ip.handle = h; if (ip.enabled === true && !/^[^\s<>"'`]{3,120}$/.test(h)) throw badRequest('InstaPay address is required (e.g. name@instapay or the registered phone number)'); }
      }
      db.insert(platformSettings).values({ key, value }).onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date().toISOString() } }).run();
      audit(req, 'platform.settings.updated', 'setting', key); res.json({ data: { key, value } });
    } catch (e) { next(e); }
  });

  // ---- staff & audit ----
  r.post('/staff', need('staff.manage'), async (req, res, next) => {
    try { const s = await createPlatformStaff(db, req.body); audit(req, 'platform.staff.created', 'user', s.id, { role: s.role, department: s.department }); res.status(201).json({ data: s }); }
    catch (e) { next(isUnique(e) ? conflict('Email already registered') : e); }
  });
  r.get('/audit-logs', need('audit.read'), (req, res, next) => {
    try {
      const q = page.parse(req.query);
      res.json({ data: db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all(), meta: { page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });
  mountPlatformExtras(r, db, need, audit);
  return r;
}
