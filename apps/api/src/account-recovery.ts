import { Router, type Request, type RequestHandler } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { memberships, sessions, tenants, users, type Db } from '@codela/db';
import { HttpError } from './errors';
import { hashPassword, sha256 } from './security';
import { password } from './schemas';
import { signToken, verifyToken } from './tokens';
import { enqueueSystem } from './outbox';

/**
 * Password reset + e-mail verification for business owners and staff (tenant users).
 * Same design as the customer portal: stateless signed links, reset link bound to the OLD password hash (single use),
 * identical answers whether or not the account exists, every session revoked after a reset.
 * Platform (Codela staff) accounts have no tenant to send mail through; their password is reset with the CLI (docs/PRODUCTION.md).
 */
export interface RecoveryOpts {
  secure: boolean; csrfSecret: string; limiter: RequestHandler;
  /** Overrides the host used in e-mailed links (set PUBLIC_WEB_URL in production); otherwise derived from the request. */
  publicUrl?: string;
  afterEnqueue: (tenantId: string) => Promise<void>;
}

export const VERIFY_TTL_MS = 24 * 3600_000, RESET_TTL_MS = 3600_000;

export function accountRecoveryRouter(db: Db, o: RecoveryOpts) {
  const r = Router();
  const secret = (k: string) => `${o.csrfSecret}:${k}`; // domain-separated from the CSRF / portal token secrets
  const base = (req: Request) => (o.publicUrl ?? `${o.secure ? 'https' : req.protocol}://${req.get('x-forwarded-host') ?? req.get('host')}`).replace(/\/+$/, '');
  const bad = () => new HttpError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
  /** The tenant whose outbox carries the message: the user's first active membership (users sign in to exactly one business). */
  const tenantOfUser = (userId: string) => db.select({ tenantId: memberships.tenantId }).from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'))).get()?.tenantId;

  r.post('/auth/forgot-password', o.limiter, (req, res, next) => {
    try {
      const email = z.string().trim().toLowerCase().email().parse(req.body?.email);
      const u = db.select().from(users).where(eq(users.email, email)).get();
      const tenantId = u && u.status === 'active' && !u.isPlatformStaff ? tenantOfUser(u.id) : undefined;
      if (u && tenantId) {
        const token = signToken('sreset', u.id, RESET_TTL_MS, secret('sreset'), sha256(u.passwordHash).slice(0, 16));
        enqueueSystem(db, tenantId, u.email, 'password_reset', { link: `${base(req)}/recover?reset=${token}` });
        void o.afterEnqueue(tenantId).catch(() => {});
      }
      res.json({ data: { ok: true } }); // identical answer whether or not the account exists
    } catch (e) { next(e); }
  });

  r.post('/auth/reset-password', o.limiter, async (req, res, next) => {
    try {
      const b = z.object({ token: z.string().min(10).max(600), password }).parse(req.body);
      const t = verifyToken(b.token, 'sreset', secret('sreset')); if (!t) throw bad();
      const u = db.select().from(users).where(eq(users.id, t.subject)).get();
      if (!u || u.status !== 'active' || sha256(u.passwordHash).slice(0, 16) !== t.bind) throw bad(); // single use: bound to the OLD hash
      // Possession of the mailbox proves the e-mail too; a reset also clears any lock-out so the owner can sign in straight away.
      db.update(users).set({ passwordHash: await hashPassword(b.password), failedLogins: 0, lockedUntil: null, emailVerifiedAt: u.emailVerifiedAt ?? new Date().toISOString() }).where(eq(users.id, u.id)).run();
      db.delete(sessions).where(eq(sessions.userId, u.id)).run(); // every existing session is revoked
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  r.post('/auth/verify-email', o.limiter, (req, res, next) => {
    try {
      const t = verifyToken(String(req.body?.token ?? ''), 'sverify', secret('sverify')); if (!t) throw bad();
      const u = db.select().from(users).where(eq(users.id, t.subject)).get();
      if (!u || sha256(u.email).slice(0, 16) !== t.bind) throw bad(); // a link for an old address stops working if the e-mail ever changes
      if (!u.emailVerifiedAt) db.update(users).set({ emailVerifiedAt: new Date().toISOString() }).where(eq(users.id, u.id)).run();
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  r.post('/auth/resend-verification', o.limiter, (req, res, next) => {
    try {
      const email = z.string().trim().toLowerCase().email().parse(req.body?.email);
      const u = db.select().from(users).where(eq(users.email, email)).get();
      if (u && u.status === 'active' && !u.emailVerifiedAt) sendVerification(db, o, u, base(req));
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  return r;
}

/** Queues the verification e-mail (no-op for users without a tenant). Exported so registration and invitations can reuse it. */
export function sendVerification(db: Db, o: Pick<RecoveryOpts, 'csrfSecret' | 'afterEnqueue'>, u: typeof users.$inferSelect, baseUrl: string): void {
  const m = db.select({ tenantId: memberships.tenantId }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.status, 'active'))).get();
  if (!m) return;
  const token = signToken('sverify', u.id, VERIFY_TTL_MS, `${o.csrfSecret}:sverify`, sha256(u.email).slice(0, 16));
  enqueueSystem(db, m.tenantId, u.email, 'verify_email', { link: `${baseUrl.replace(/\/+$/, '')}/recover?verify=${token}` });
  void o.afterEnqueue(m.tenantId).catch(() => {});
}
