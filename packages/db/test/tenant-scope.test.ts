import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Db } from '../src/client';
import { tenants, users } from '../src/schema';
import { scoped } from '../src/scoped';

let db: Db;
beforeEach(() => {
  db = createDb(':memory:');
  db.insert(tenants).values([
    { id: 't1', slug: 'alpha', name: 'Alpha', productSlug: 'medical' },
    { id: 't2', slug: 'beta', name: 'Beta', productSlug: 'medical' },
  ]).run();
});

describe('migrations', () => {
  it('foreign keys are enforced', () => {
    expect(() => db.insert(users).values({ id: 'u', email: 'a@b.co', passwordHash: 'x', name: 'A' }).run()).not.toThrow();
    const s = scoped(db, 'nope');
    expect(() => s.customers.insert({ name: 'X', ref: 'C1' })).toThrow();
  });
  it('slug is unique', () => {
    expect(() => db.insert(tenants).values({ id: 't3', slug: 'alpha', name: 'Dup', productSlug: 'medical' }).run()).toThrow();
  });
});

describe('tenant-scoped data access', () => {
  it('insert forces the tenant id', () => {
    const c = scoped(db, 't1').customers.insert({ name: 'Ali', ref: 'C1', phone: '01000000000' });
    expect(c.tenantId).toBe('t1');
  });
  it('insert cannot be redirected to another tenant', () => {
    const c = scoped(db, 't1').customers.insert({ name: 'Ali', ref: 'C1', tenantId: 't2' } as never);
    expect(c.tenantId).toBe('t1');
  });
  it('list only returns own tenant rows', () => {
    scoped(db, 't1').customers.insert({ name: 'Ali', ref: 'C1' });
    scoped(db, 't2').customers.insert({ name: 'Omar', ref: 'C1' });
    const l1 = scoped(db, 't1').customers.list();
    expect(l1.map((c) => c.name)).toEqual(['Ali']);
  });
  it('get by id cannot cross tenants', () => {
    const c = scoped(db, 't1').customers.insert({ name: 'Ali', ref: 'C1' });
    expect(scoped(db, 't1').customers.get(c.id)?.name).toBe('Ali');
    expect(scoped(db, 't2').customers.get(c.id)).toBeUndefined();
  });
  it('update/delete cannot cross tenants', () => {
    const c = scoped(db, 't1').customers.insert({ name: 'Ali', ref: 'C1' });
    expect(scoped(db, 't2').customers.update(c.id, { name: 'Hacked' })).toBe(0);
    expect(scoped(db, 't2').customers.remove(c.id)).toBe(0);
    expect(scoped(db, 't1').customers.get(c.id)?.name).toBe('Ali');
    expect(scoped(db, 't1').customers.remove(c.id)).toBe(1);
  });
  it('reference unique per tenant, not globally', () => {
    scoped(db, 't1').customers.insert({ name: 'A', ref: 'C1' });
    expect(() => scoped(db, 't1').customers.insert({ name: 'B', ref: 'C1' })).toThrow();
    expect(() => scoped(db, 't2').customers.insert({ name: 'B', ref: 'C1' })).not.toThrow();
  });
  it('rejects empty tenant id', () => { expect(() => scoped(db, '')).toThrow(); });
});
