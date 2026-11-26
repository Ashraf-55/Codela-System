import { and, eq } from 'drizzle-orm';
import { memberships, roles, users, type Db } from '@codela/db';

/** E-mail address of the tenant owner (recipient of billing notices). */
export function ownerEmail(db: Db, tenantId: string): string | undefined {
  return db.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, 'active'), eq(roles.name, 'owner'))).get()?.email;
}
