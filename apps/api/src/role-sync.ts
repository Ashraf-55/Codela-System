import { and, eq } from 'drizzle-orm';
import { rolePermissions, roles, tenants, type Db } from '@codela/db';
import { getProduct } from './products/registry';

const perms = (m: Record<string, string[]>) => Object.entries(m).flatMap(([mod, acts]) => acts.map((a) => `${mod}.${a}`));

/** Permissions a product-specific role should hold (undefined for roles that are not product-defined). */
export function productRolePermissions(slug: string, role: string): string[] | undefined {
  const p = getProduct(slug); if (!p) return undefined;
  if (role === 'manager') return p.entities.map((e) => `${e.module}.*`);
  if (role === 'employee') return perms(p.employeeModules);
  const r = p.roles?.[role]; return r ? perms(r.modules) : undefined;
}

/** Idempotent and additive: gives existing tenants the permissions of modules/roles added after they registered. Never removes anything. */
export function syncRolePermissions(db: Db) {
  for (const t of db.select().from(tenants).all()) {
    for (const r of db.select().from(roles).where(eq(roles.tenantId, t.id)).all()) {
      const want = productRolePermissions(t.productSlug, r.name); if (!want) continue;
      const have = new Set(db.select().from(rolePermissions).where(eq(rolePermissions.roleId, r.id)).all().map((x) => x.permission));
      for (const p of want) if (!have.has(p)) db.insert(rolePermissions).values({ roleId: r.id, permission: p }).run();
    }
  }
}

/** Returns the role row of a tenant, creating it from the product definition when it is a product role that was never used before. */
export function ensureProductRole(db: Db, tenantId: string, slug: string, name: string) {
  let role = db.select().from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.name, name))).get(); if (role) return role;
  const want = getProduct(slug)?.roles?.[name] ? productRolePermissions(slug, name) : undefined; if (!want) return undefined;
  role = db.insert(roles).values({ tenantId, name, isSystem: true }).returning().get();
  for (const p of want) db.insert(rolePermissions).values({ roleId: role.id, permission: p }).run();
  return role;
}
