export const PERMISSIONS = [
  'customers.read', 'customers.create', 'customers.update', 'customers.delete',
  'employees.read', 'employees.manage', 'roles.manage',
  'tenant.settings', 'subscription.manage', 'reports.read', 'search.use', 'audit.read', 'domains.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = {
  owner: ['*'],
  manager: ['customers.*', 'employees.read', 'reports.read', 'search.use', 'audit.read'],
  employee: ['customers.read', 'customers.create', 'customers.update', 'search.use'],
} as const satisfies Record<string, readonly string[]>;
export type SystemRoleName = keyof typeof SYSTEM_ROLES;

export function isValidPermission(key: string): key is Permission {
  return (PERMISSIONS as readonly string[]).includes(key);
}

/** Grants: '*' = all, 'module.*' = whole module, otherwise exact key. */
export function hasPermission(granted: readonly string[], needed: string): boolean {
  if (granted.includes('*') || granted.includes(needed)) return true;
  const mod = needed.split('.')[0];
  return granted.includes(`${mod}.*`);
}

export const PLATFORM_ROLES = {
  super_admin: ['*'],
  support: ['tenants.read', 'revenue.read', 'audit.read', 'sales.read'],
  finance: ['tenants.read', 'revenue.read', 'plans.manage', 'payments.review', 'reports.export'],
  sales: ['tenants.read', 'sales.read', 'sales.manage', 'tasks.manage'],
} as const satisfies Record<string, readonly string[]>;
export type PlatformRoleName = keyof typeof PLATFORM_ROLES;
export const PLATFORM_DEPARTMENTS = ['development', 'design', 'marketing', 'sales', 'management'] as const;
