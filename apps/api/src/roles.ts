import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, memberships, rolePermissions, roles, tenants, users, type Db } from '@codela/db';
import { requirePermission } from './auth';
import { badRequest, conflict, notFound } from './errors';
import { getProduct } from './products/registry';
import { ensureProductRole } from './role-sync';
import type { ProductDef } from './products/framework';

/** Core permissions an owner may hand to a custom role. Owner-only powers (roles, employees.manage, billing, settings, domains) are never grantable, so a custom role cannot escalate. */
const CORE_GRANTABLE = ['reports.read', 'search.use', 'audit.read', 'employees.read'];
const RESERVED = new Set(['owner', 'manager', 'employee', 'driver', 'admin', 'super_admin', 'support', 'finance', 'sales']);
const ROLE_NAME = /^[a-z][a-z_]{2,29}$/; // same alphabet employee creation accepts

/** Everything a custom role of this product can be built from: module -> actions. `approve` exists only where the module has an approval decision. */
export function permissionCatalog(p: ProductDef) {
  const mods = new Map<string, { module: string; labelEn: string; labelAr: string; actions: Set<string> }>();
  for (const e of p.entities) {
    const m = mods.get(e.module) ?? { module: e.module, labelEn: e.labelEn, labelAr: e.labelAr, actions: new Set(['read', 'create', 'update', 'delete', 'export']) }; mods.set(e.module, m);
    if (e.approvals) m.actions.add('approve');
  }
  return { modules: [...mods.values()].map((m) => ({ module: m.module, labelEn: m.labelEn, labelAr: m.labelAr, actions: [...m.actions] })), core: CORE_GRANTABLE };
}
const grantable = (p: ProductDef) => new Set([...permissionCatalog(p).modules.flatMap((m) => m.actions.map((a) => `${m.module}.${a}`)), ...CORE_GRANTABLE]);

export function rolesRouter(db: Db) {
  const r = Router();
  const slug = (tenantId: string) => db.select({ p: tenants.productSlug }).from(tenants).where(eq(tenants.id, tenantId)).get()!.p;
  const prod = (tenantId: string) => getProduct(slug(tenantId))!;
  const audit = (tenantId: string, actorId: string, action: string, entityId?: string, meta?: Record<string, unknown>) => db.insert(auditLogs).values({ tenantId, actorId, action, entity: 'role', entityId, meta }).run();
  const permsOf = (roleId: string) => db.select({ p: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId)).all().map((x) => x.p).sort();

  r.get('/permission-catalog', requirePermission('roles.manage'), (req, res) => res.json({ data: permissionCatalog(prod(req.auth!.tenantId)) }));

  // roles an owner can give to staff: base roles, the product's job roles, and this tenant's own custom roles
  r.get('/roles', requirePermission('employees.read'), (req, res) => {
    const t = req.auth!.tenantId; const p = prod(t); const can = req.auth!.permissions.includes('*') || req.auth!.permissions.includes('roles.manage');
    const custom = db.select().from(roles).where(and(eq(roles.tenantId, t), eq(roles.isSystem, false))).all().map((x) => ({ name: x.name, labelEn: x.name, labelAr: x.name, custom: true, id: x.id, ...(can ? { permissions: permsOf(x.id) } : {}) }));
    const extra = Object.entries(p.roles ?? {}).map(([name, d]) => ({ name, labelEn: d.labelEn, labelAr: d.labelAr, custom: false }));
    res.json({ data: [{ name: 'manager', labelEn: 'Manager', labelAr: 'مدير', custom: false }, { name: 'employee', labelEn: 'Employee', labelAr: 'موظف', custom: false }, ...extra, ...custom] });
  });

  const body = z.object({ name: z.string().trim().toLowerCase().regex(ROLE_NAME, 'lowercase letters and underscores, 3–30 characters'), permissions: z.array(z.string().max(80)).min(1).max(200) });
  const checked = (t: string, perms: string[]) => { const ok = grantable(prod(t)); const bad = perms.filter((x) => !ok.has(x)); if (bad.length) throw badRequest(`Permissions that cannot be granted to a custom role: ${bad.slice(0, 5).join(', ')}`); return [...new Set(perms)]; };

  r.post('/roles', requirePermission('roles.manage'), (req, res, next) => {
    try {
      const b = body.parse(req.body); const t = req.auth!.tenantId; const p = prod(t);
      if (RESERVED.has(b.name) || p.roles?.[b.name]) throw conflict('This role name is reserved');
      if (db.select().from(roles).where(and(eq(roles.tenantId, t), eq(roles.name, b.name))).get()) throw conflict('A role with this name already exists');
      const perms = checked(t, b.permissions);
      const role = db.transaction((tx) => { const row = tx.insert(roles).values({ tenantId: t, name: b.name, isSystem: false }).returning().get(); for (const x of perms) tx.insert(rolePermissions).values({ roleId: row.id, permission: x }).run(); return row; });
      audit(t, req.auth!.userId, 'role.created', role.id, { name: b.name, permissions: perms });
      res.status(201).json({ data: { id: role.id, name: role.name, custom: true, permissions: perms.sort() } });
    } catch (e) { next(e); }
  });
  const customOf = (t: string, name: string) => { const row = db.select().from(roles).where(and(eq(roles.tenantId, t), eq(roles.name, name))).get(); if (!row) throw notFound('Role not found'); if (row.isSystem) throw conflict('Built-in roles cannot be edited'); return row; };
  r.put('/roles/:name', requirePermission('roles.manage'), (req, res, next) => {
    try {
      const t = req.auth!.tenantId; const row = customOf(t, String(req.params.name)); const b = z.object({ permissions: body.shape.permissions }).parse(req.body); const perms = checked(t, b.permissions);
      db.transaction((tx) => { tx.delete(rolePermissions).where(eq(rolePermissions.roleId, row.id)).run(); for (const x of perms) tx.insert(rolePermissions).values({ roleId: row.id, permission: x }).run(); });
      audit(t, req.auth!.userId, 'role.updated', row.id, { name: row.name, permissions: perms }); res.json({ data: { id: row.id, name: row.name, custom: true, permissions: perms.sort() } });
    } catch (e) { next(e); }
  });
  r.delete('/roles/:name', requirePermission('roles.manage'), (req, res, next) => {
    try {
      const t = req.auth!.tenantId; const row = customOf(t, String(req.params.name));
      if (db.select().from(memberships).where(eq(memberships.roleId, row.id)).get()) throw conflict('This role is assigned to staff; move them to another role first');
      db.delete(roles).where(eq(roles.id, row.id)).run(); audit(t, req.auth!.userId, 'role.deleted', row.id, { name: row.name }); res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  // move a staff member to another role (the owner and yourself are never changed)
  r.put('/employees/:id/role', requirePermission('roles.manage'), (req, res, next) => {
    try {
      const t = req.auth!.tenantId; const id = String(req.params.id); const b = z.object({ role: z.string().regex(/^[a-z][a-z_]{1,29}$/).refine((x) => !['owner', 'driver'].includes(x), 'This role cannot be assigned here') }).parse(req.body);
      const m = db.select({ mid: memberships.id, role: roles.name }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.userId, id), eq(memberships.tenantId, t))).get();
      if (!m) throw notFound('Member not found'); if (m.role === 'owner' || m.role === 'driver' || id === req.auth!.userId) throw conflict('This account cannot change role');
      const role = ensureProductRole(db, t, slug(t), b.role) ?? db.select().from(roles).where(and(eq(roles.tenantId, t), eq(roles.name, b.role))).get(); if (!role) throw badRequest('Unknown role');
      db.update(memberships).set({ roleId: role.id }).where(eq(memberships.id, m.mid)).run(); audit(t, req.auth!.userId, 'employee.role_changed', id, { from: m.role, to: b.role });
      void users; res.json({ data: { id, role: b.role } });
    } catch (e) { next(e); }
  });
  return r;
}
