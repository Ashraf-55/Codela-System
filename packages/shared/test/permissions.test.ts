import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLES, hasPermission, isValidPermission } from '../src/permissions';

describe('permissions', () => {
  it('owner has everything incl. wildcard', () => expect(hasPermission(SYSTEM_ROLES.owner, 'customers.delete')).toBe(true));
  it('employee cannot manage employees', () => expect(hasPermission(SYSTEM_ROLES.employee, 'employees.manage')).toBe(false));
  it('employee can read customers', () => expect(hasPermission(SYSTEM_ROLES.employee, 'customers.read')).toBe(true));
  it('module wildcard', () => expect(hasPermission(['customers.*'], 'customers.update')).toBe(true));
  it('validates keys', () => { expect(isValidPermission('customers.read')).toBe(true); expect(isValidPermission('nope')).toBe(false); });
});
