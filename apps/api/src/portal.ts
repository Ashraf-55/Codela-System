import express, { Router, type Request, type Response, type RequestHandler } from 'express';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { notificationOutbox, portalAccounts, portalSessions, tenants, type Db } from '@codela/db';
import { HttpError, notFound, unauthorized, forbidden } from './errors';
import { DUMMY_HASH, csrfFor, hashPassword, newToken, safeEqual, sha256, verifyPassword } from './security';
import { password } from './schemas';
import { signToken, verifyToken } from './tokens';
import { enqueue } from './outbox';
import { portalLoginAttempt } from './login-gate';
import { assertWritable } from './entitlements';
import { productOf } from './products/routes';
import { listRecords } from './products/store';
import { TEMPLATES } from './templates';
import { avatarFile, removeAvatar, saveAvatar } from './avatars';
import { learningPortalRoutes } from './portal-learning';
import { returnsPortalRoutes } from './portal-returns';
import { MAX_UPLOAD_BYTES } from './file-validation';
import { absPath, send } from './uploads';

// Distinct from the staff (`sid`/`csrf`) and platform-admin (`psid`/`pcsrf`) cookies: sharing a name would let one login overwrite the other.
export const PORTAL_COOKIE = 'cust_sid', PORTAL_CSRF = 'cust_csrf';

/** What an end customer / student may see about THEIR OWN records. Whitelists only: internal notes and staff-only fields are never returned. */
export const PORTAL_MAP: Record<string, { person: string; children: { entity: string; ref: string; fields: string[]; /** result fields stay hidden until the record reaches one of these statuses (a draft report is never shown) */ hideUnless?: { field: string; values: string[]; fields: string[] } }[] }> = {
  medical: { person: 'patient', children: [{ entity: 'appointment', ref: 'patientId', fields: ['doctorId', 'serviceId', 'date', 'startTime', 'durationMin', 'status'] },
    { entity: 'labRequest', ref: 'patientId', fields: ['test', 'status', 'results', 'resultText', 'resultedAt'], hideUnless: { field: 'status', values: ['resulted'], fields: ['results', 'resultText', 'resultedAt'] } },
    { entity: 'imagingRequest', ref: 'patientId', fields: ['modality', 'bodyPart', 'status', 'scheduledAt', 'reportText', 'reportedAt'], hideUnless: { field: 'status', values: ['reported'], fields: ['reportText', 'reportedAt'] } }] },
  booking: { person: 'customer', children: [{ entity: 'appointment', ref: 'customerId', fields: ['serviceId', 'staffId', 'branchId', 'date', 'startTime', 'endTime', 'durationMin', 'status', 'price', 'paidAmount'] }] },
  ecommerce: { person: 'customer', children: [{ entity: 'order', ref: 'customerId', fields: ['status', 'paymentStatus', 'trackingNumber', 'carrier', 'subtotal', 'discount', 'shippingFee', 'tax', 'total', 'placedAt', 'items'] }] },
  learning: { person: 'student', children: [
    { entity: 'enrollment', ref: 'studentId', fields: ['courseId', 'status', 'accessUntil', 'price', 'paidAmount', 'paymentStatus', 'progressPct', 'enrolledAt'] },
    { entity: 'certificate', ref: 'studentId', fields: ['enrollmentId', 'courseId', 'verifyCode', 'issuedAt'] } ] },
};

/** Templates a customer may see in their notification list (no verification / reset links, no business-internal notices). */
const CUSTOMER_TEMPLATES = ['booking_created', 'appointment_confirmed', 'appointment_reminder', 'order_update', 'status_update', 'payment_confirmation'] as const;
/** Where the money fields live per product, for the customer's payment history. `paid` omitted => paid in full only when status === 'paid'. */
const PAYMENT_MAP: Record<string, { entity: string; ref: string; total: string; paid?: string; status: string; skip?: { field: string; values: string[] } }> = {
  medical: { entity: 'invoice', ref: 'patientId', total: 'total', paid: 'paidAmount', status: 'status', skip: { field: 'status', values: ['draft', 'cancelled'] } },
  booking: { entity: 'appointment', ref: 'customerId', total: 'price', paid: 'paidAmount', status: 'status', skip: { field: 'status', values: ['cancelled'] } },
  ecommerce: { entity: 'order', ref: 'customerId', total: 'total', status: 'paymentStatus', skip: { field: 'status', values: ['cancelled'] } },
  learning: { entity: 'enrollment', ref: 'studentId', total: 'price', paid: 'paidAmount', status: 'paymentStatus' },
};

const strongPw = password;
const reg = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(254), phone: z.string().trim().max(30).optional(), password: strongPw, locale: z.enum(['ar', 'en']).default('ar') });
const login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });

export interface PortalOpts { secure: boolean; csrfSecret: string; sessionMs: number; limiter: RequestHandler; requireEmailVerification: boolean; afterEnqueue: (tenantId: string) => Promise<void>; resolveTenant: (host: string) => { id: string } | undefined; uploadDir: string }

export function portalRouter(db: Db, o: PortalOpts) {
  const r = Router();
  const tenantOf = (req: Request) => { const t = o.resolveTenant(req.hostname.toLowerCase()); if (!t) throw notFound('Site not found'); return t.id; };
  const origin = (req: Request) => `${o.secure ? 'https' : req.protocol}://${req.get('x-forwarded-host') ?? req.get('host')}`;
  const secret = (k: string) => `${o.csrfSecret}:${k}`; // domain-separated from the CSRF/session secret use

  function startSession(res: Response, accountId: string, tenantId: string) {
    const token = newToken(); const expires = new Date(Date.now() + o.sessionMs);
    db.insert(portalSessions).values({ tokenHash: sha256(token), accountId, tenantId, expiresAt: expires.toISOString() }).run();
    const csrf = csrfFor(token, o.csrfSecret);
    res.cookie(PORTAL_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: o.secure, expires, path: '/' });
    res.cookie(PORTAL_CSRF, csrf, { httpOnly: false, sameSite: 'lax', secure: o.secure, expires, path: '/' });
    return csrf;
  }
  const publicAccount = (a: typeof portalAccounts.$inferSelect) => ({ id: a.id, name: a.name, email: a.email, phone: a.phone, locale: a.locale, hasAvatar: !!a.avatarFileId });

  /** Portal auth: session cookie -> account. Tenant comes from the SESSION, and must equal the tenant of the host being called. */
  const auth: RequestHandler = (req, _res, next) => {
    try {
      const token = req.cookies?.[PORTAL_COOKIE] as string | undefined; if (!token) throw unauthorized();
      const row = db.select({ accountId: portalSessions.accountId, tenantId: portalSessions.tenantId, expiresAt: portalSessions.expiresAt, status: portalAccounts.status, tstatus: tenants.status })
        .from(portalSessions).innerJoin(portalAccounts, eq(portalAccounts.id, portalSessions.accountId)).innerJoin(tenants, eq(tenants.id, portalSessions.tenantId)).where(eq(portalSessions.tokenHash, sha256(token))).get();
      if (!row || row.expiresAt <= new Date().toISOString() || row.status !== 'active' || row.tstatus === 'closed' || row.tstatus === 'suspended') throw unauthorized();
      if (row.tenantId !== tenantOf(req)) throw unauthorized(); // a session from tenant A is worthless on tenant B's site
      if (req.method !== 'GET') {
        const want = csrfFor(token, o.csrfSecret); const h = req.get('x-csrf-token') ?? ''; const c = (req.cookies?.[PORTAL_CSRF] as string | undefined) ?? '';
        if (!h || !safeEqual(h, want) || !safeEqual(c, want)) throw forbidden('Invalid CSRF token');
      }
      (req as any).portal = { accountId: row.accountId, tenantId: row.tenantId, token }; next();
    } catch (e) { next(e); }
  };
  const P = (req: Request) => (req as any).portal as { accountId: string; tenantId: string; token: string };
  const sendMail = (tenantId: string, to: string, template: string, payload: Record<string, unknown>) => { enqueue(db, tenantId, 'email', to, template, payload); void o.afterEnqueue(tenantId).catch(() => {}); };

  r.post('/portal/register', o.limiter, async (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const b = reg.parse(req.body); assertWritable(db, tenantId);
      const hash = await hashPassword(b.password);
      const status = o.requireEmailVerification ? 'pending' : 'active';
      let acc: typeof portalAccounts.$inferSelect | undefined;
      try { acc = db.insert(portalAccounts).values({ tenantId, email: b.email, phone: b.phone, passwordHash: hash, name: b.name, locale: b.locale, status }).returning().get(); }
      catch (e) { if (!/UNIQUE constraint failed/.test(String((e as Error).message))) throw e; /* existing e-mail: answer identically (no account enumeration) */ }
      if (!o.requireEmailVerification) { if (!acc) throw new HttpError(409, 'CONFLICT', 'An account with this e-mail already exists'); return void res.status(201).json({ data: { account: publicAccount(acc), csrfToken: startSession(res, acc.id, tenantId), verified: true } }); }
      if (acc) sendMail(tenantId, acc.email, 'verify_email', { link: `${origin(req)}/portal?verify=${signToken('pverify', acc.id, 24 * 3600_000, secret('pverify'))}` });
      res.status(202).json({ data: { verificationRequired: true } });
    } catch (e) { next(e); }
  });

  r.post('/portal/verify-email', o.limiter, (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const t = verifyToken(String(req.body?.token ?? ''), 'pverify', secret('pverify')); if (!t) throw new HttpError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
      const n = db.update(portalAccounts).set({ status: 'active' }).where(and(eq(portalAccounts.id, t.subject), eq(portalAccounts.tenantId, tenantId), eq(portalAccounts.status, 'pending'))).run().changes;
      if (!n) { const a = db.select().from(portalAccounts).where(and(eq(portalAccounts.id, t.subject), eq(portalAccounts.tenantId, tenantId))).get(); if (a?.status !== 'active') throw new HttpError(400, 'INVALID_TOKEN', 'This link is invalid or has expired'); }
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  r.post('/portal/login', o.limiter, async (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const b = login.parse(req.body);
      const a = db.select().from(portalAccounts).where(and(eq(portalAccounts.tenantId, tenantId), eq(portalAccounts.email, b.email))).get();
      const ok = await verifyPassword(b.password, a?.passwordHash ?? DUMMY_HASH);
      portalLoginAttempt(db, a, ok); // generic failure when unknown/wrong; 15-minute lock after 5 failures
      if (!a) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      if (a.status === 'pending') throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Please confirm your e-mail first');
      if (a.status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');
      res.json({ data: { account: publicAccount(a), csrfToken: startSession(res, a.id, tenantId) } });
    } catch (e) { next(e); }
  });

  r.post('/portal/forgot-password', o.limiter, (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const email = z.string().trim().toLowerCase().email().parse(req.body?.email);
      const a = db.select().from(portalAccounts).where(and(eq(portalAccounts.tenantId, tenantId), eq(portalAccounts.email, email), eq(portalAccounts.status, 'active'))).get();
      if (a) sendMail(tenantId, a.email, 'password_reset', { link: `${origin(req)}/portal?reset=${signToken('preset', a.id, 3600_000, secret('preset'), sha256(a.passwordHash).slice(0, 16))}` });
      res.json({ data: { ok: true } }); // identical answer whether or not the account exists
    } catch (e) { next(e); }
  });
  r.post('/portal/reset-password', o.limiter, async (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const b = z.object({ token: z.string().min(10).max(600), password: strongPw }).parse(req.body);
      const t = verifyToken(b.token, 'preset', secret('preset')); const bad = new HttpError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
      if (!t) throw bad;
      const a = db.select().from(portalAccounts).where(and(eq(portalAccounts.id, t.subject), eq(portalAccounts.tenantId, tenantId), eq(portalAccounts.status, 'active'))).get();
      if (!a || sha256(a.passwordHash).slice(0, 16) !== t.bind) throw bad; // single use: the token is bound to the OLD password hash
      db.update(portalAccounts).set({ passwordHash: await hashPassword(b.password) }).where(eq(portalAccounts.id, a.id)).run();
      db.delete(portalSessions).where(eq(portalSessions.accountId, a.id)).run(); // every existing session is revoked
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  r.post('/portal/logout', auth, (req, res) => { db.delete(portalSessions).where(eq(portalSessions.tokenHash, sha256(P(req).token))).run(); res.clearCookie(PORTAL_COOKIE); res.clearCookie(PORTAL_CSRF); res.json({ data: { ok: true } }); });
  r.get('/portal/me', auth, (req, res) => { const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, P(req).accountId)).get()!; res.json({ data: publicAccount(a) }); });
  r.patch('/portal/me', auth, (req, res, next) => {
    try {
      const b = z.object({ name: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(30).nullable().optional(), locale: z.enum(['ar', 'en']).optional() }).strict().parse(req.body);
      if (Object.keys(b).length) db.update(portalAccounts).set(b).where(eq(portalAccounts.id, P(req).accountId)).run();
      res.json({ data: publicAccount(db.select().from(portalAccounts).where(eq(portalAccounts.id, P(req).accountId)).get()!) });
    } catch (e) { next(e); }
  });
  r.post('/portal/change-password', auth, async (req, res, next) => {
    try {
      const b = z.object({ current: z.string().min(1).max(128), next: strongPw }).parse(req.body);
      const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, P(req).accountId)).get()!;
      if (!(await verifyPassword(b.current, a.passwordHash))) throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      db.update(portalAccounts).set({ passwordHash: await hashPassword(b.next) }).where(eq(portalAccounts.id, a.id)).run();
      db.delete(portalSessions).where(and(eq(portalSessions.accountId, a.id), ne(portalSessions.tokenHash, sha256(P(req).token)))).run(); // sign out every OTHER device
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  /** The caller's own records: the person record in THIS tenant whose e-mail equals the (verified) account e-mail, plus its whitelisted children. */
  r.get('/portal/my', auth, (req, res, next) => {
    try {
      const { accountId, tenantId } = P(req); const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId)).get()!;
      const product = productOf(db, tenantId); const map = PORTAL_MAP[product.slug];
      if (!map) return void res.json({ data: { person: null, items: {}, supported: false, product: product.slug } });
      const personDef = product.entities.find((e) => e.key === map.person)!;
      const person = listRecords(db, tenantId, personDef, { forced: { email: a.email }, page: 1, pageSize: 1, params: {} }).rows[0];
      if (!person) return void res.json({ data: { person: null, items: {}, supported: true, product: product.slug } });
      const items: Record<string, unknown[]> = {};
      for (const c of map.children) {
        const def = product.entities.find((e) => e.key === c.entity)!;
        items[c.entity] = listRecords(db, tenantId, def, { forced: { [c.ref]: person.id }, page: 1, pageSize: 100, params: {} }).rows
          .map((row) => ({ id: row.id, code: row.code, createdAt: row.createdAt, ...Object.fromEntries(c.fields.filter((f) => f in row.data && !(c.hideUnless?.fields.includes(f) && !c.hideUnless.values.includes(String(row.data[c.hideUnless.field])))).map((f) => [f, row.data[f]])) }));
      }
      // the customer's own payment requests (InstaPay / Vodafone Cash): matched by the phone on their record; internal fields stay hidden
      const prDef = product.entities.find((e) => e.key === 'paymentRequest'); const phone = String(person.data.phone ?? '');
      const paymentRequests = prDef && phone ? listRecords(db, tenantId, prDef, { forced: { payerPhone: phone }, page: 1, pageSize: 50, params: {} }).rows
        .map((r) => ({ code: r.code, targetCode: r.data.targetCode, method: r.data.method, amount: r.data.amount, status: r.data.status, reviewNote: ['rejected', 'refunded'].includes(String(r.data.status)) ? r.data.reviewNote ?? '' : '', createdAt: r.createdAt })) : [];
      res.json({ data: { person: { id: person.id, code: person.code, name: person.data.name }, items, paymentRequests, supported: true, product: product.slug } });
    } catch (e) { next(e); }
  });
  // ---- profile picture (own picture only; private file, served through the authenticated portal session) ----
  r.get('/portal/avatar', auth, (req, res, next) => {
    try { const { accountId, tenantId } = P(req); const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId)).get()!; const f = avatarFile(db, tenantId, accountId, a.avatarFileId); send(res, absPath(o.uploadDir, f.tenantId, f.storageKey), f, 'inline', 'private, no-store'); } catch (e) { next(e); }
  });
  r.put('/portal/avatar', auth, express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), (req, res, next) => {
    try {
      const { accountId, tenantId } = P(req); assertWritable(db, tenantId); const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId)).get()!;
      const f = saveAvatar(db, o.uploadDir, { tenantId, ownerId: accountId, previousFileId: a.avatarFileId, body: req.body, fileName: req.get('x-file-name') });
      db.update(portalAccounts).set({ avatarFileId: f.id }).where(eq(portalAccounts.id, accountId)).run();
      res.json({ data: { version: f.id } });
    } catch (e) { next(e); }
  });
  r.delete('/portal/avatar', auth, (req, res, next) => {
    try { const { accountId, tenantId } = P(req); const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId)).get()!; removeAvatar(db, o.uploadDir, tenantId, accountId, a.avatarFileId); db.update(portalAccounts).set({ avatarFileId: null }).where(eq(portalAccounts.id, accountId)).run(); res.json({ data: { ok: true } }); } catch (e) { next(e); }
  });

  // ---- student learning: lessons, exams, assignments, certificate (learning product only; see portal-learning.ts) ----
  learningPortalRoutes(r, db, { uploadDir: o.uploadDir, auth, who: (req) => { const p = P(req); return { tenantId: p.tenantId, email: db.select({ e: portalAccounts.email }).from(portalAccounts).where(eq(portalAccounts.id, p.accountId)).get()!.e }; } });

  // ---- e-commerce returns: the customer asks to return lines of their own delivered orders (see portal-returns.ts) ----
  returnsPortalRoutes(r, db, { auth, who: (req) => { const p = P(req); return { tenantId: p.tenantId, email: db.select({ e: portalAccounts.email }).from(portalAccounts).where(eq(portalAccounts.id, p.accountId)).get()!.e }; } });

  // ---- notifications: the customer-facing messages this business sent to the account's e-mail ----
  // Whitelist: verification / reset links are never listed. Status is honest: only `sent` means a provider accepted the message.
  r.get('/portal/notifications', auth, (req, res, next) => {
    try {
      const { accountId, tenantId } = P(req); const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId)).get()!;
      const rows = db.select().from(notificationOutbox).where(and(eq(notificationOutbox.tenantId, tenantId), eq(notificationOutbox.toAddr, a.email), eq(notificationOutbox.channel, 'email'), inArray(notificationOutbox.template, [...CUSTOMER_TEMPLATES]))).orderBy(desc(notificationOutbox.createdAt)).limit(50).all();
      res.json({ data: rows.map((n) => { const m = TEMPLATES[n.template]?.(n.payload); return { id: n.id, template: n.template, subject: m?.subject ?? n.template, body: m?.body ?? '', createdAt: n.createdAt, delivery: n.status === 'sent' ? 'sent' : n.status === 'queued' ? 'pending' : 'not_delivered' }; }) });
    } catch (e) { next(e); }
  });

  // ---- payment history: what the customer owes / paid on THEIR OWN records (read-only, whitelisted fields) ----
  r.get('/portal/payments', auth, (req, res, next) => {
    try {
      const { accountId, tenantId } = P(req); const a = db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId)).get()!;
      const product = productOf(db, tenantId); const map = PORTAL_MAP[product.slug]; const pay = PAYMENT_MAP[product.slug];
      const currency = db.select({ c: tenants.currency }).from(tenants).where(eq(tenants.id, tenantId)).get()?.c ?? 'EGP';
      if (!map || !pay) return void res.json({ data: { supported: false, currency, rows: [] } });
      const personDef = product.entities.find((e) => e.key === map.person)!;
      const person = listRecords(db, tenantId, personDef, { forced: { email: a.email }, page: 1, pageSize: 1, params: {} }).rows[0];
      if (!person) return void res.json({ data: { supported: true, currency, rows: [] } });
      const def = product.entities.find((e) => e.key === pay.entity)!;
      const rows = listRecords(db, tenantId, def, { forced: { [pay.ref]: person.id }, page: 1, pageSize: 100, params: {} }).rows
        .filter((row) => !pay.skip || !pay.skip.values.includes(String(row.data[pay.skip.field] ?? '')))
        .map((row) => { const total = Number(row.data[pay.total] ?? 0); const status = String(row.data[pay.status] ?? '');
          const paid = pay.paid ? Number(row.data[pay.paid] ?? 0) : status === 'paid' ? total : 0;
          return { id: row.id, code: row.code, kind: pay.entity, date: row.createdAt, total, paid, balance: Math.max(0, total - paid), status }; });
      res.json({ data: { supported: true, currency, rows } });
    } catch (e) { next(e); }
  });
  return r;
}
