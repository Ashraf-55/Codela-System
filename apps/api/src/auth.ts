import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { memberships, rolePermissions, roles, sessions, tenants, users, type Db } from '@codela/db';
import { hasPermission } from '@codela/shared';
import { csrfFor, safeEqual, sha256 } from './security';
import { HttpError, forbidden, unauthorized } from './errors';

export interface AuthContext {
  userId: string; tenantId: string; sessionToken: string; roleName: string; permissions: string[];
}
declare module 'express-serve-static-core' { interface Request { auth?: AuthContext } }

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Resolve the session cookie into an AuthContext. Tenant comes ONLY from the server-side session. */
export function authenticate(db: Db, csrfSecret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
      if (!token) throw unauthorized();
      const row = db.select({
        userId: sessions.userId, tenantId: sessions.tenantId, expiresAt: sessions.expiresAt,
        userStatus: users.status, tenantStatus: tenants.status,
      }).from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
        .where(eq(sessions.tokenHash, sha256(token))).get();
      if (!row || !row.tenantId || row.expiresAt <= new Date().toISOString() || row.userStatus !== 'active' || row.tenantStatus === 'closed') throw unauthorized();
      if (row.tenantStatus === 'suspended') throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');

      const m = db.select({ roleId: memberships.roleId, roleName: roles.name }).from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.userId, row.userId), eq(memberships.tenantId, row.tenantId), eq(memberships.status, 'active'))).get();
      if (!m) throw unauthorized();

      if (MUTATING.has(req.method)) {
        const header = req.get('x-csrf-token') ?? '';
        const cookie = (req.cookies?.[CSRF_COOKIE] as string | undefined) ?? '';
        const expected = csrfFor(token, csrfSecret);
        if (!header || !safeEqual(header, expected) || !safeEqual(cookie, expected)) throw forbidden('Invalid CSRF token');
      }
      const permissions = db.select({ p: rolePermissions.permission }).from(rolePermissions)
        .where(eq(rolePermissions.roleId, m.roleId)).all().map((r) => r.p);
      req.auth = { userId: row.userId, tenantId: row.tenantId, sessionToken: token, roleName: m.roleName, permissions };
      next();
    } catch (e) { next(e); }
  };
}

export function requirePermission(key: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!hasPermission(req.auth.permissions, key)) return next(forbidden());
    next();
  };
}
