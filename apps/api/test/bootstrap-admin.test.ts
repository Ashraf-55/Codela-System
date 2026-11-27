import { describe, expect, it } from 'vitest';
import { count } from 'drizzle-orm';
import { createDb, platformStaff, seedPlatform } from '@codela/db';
import { bootstrapAdmin } from '../src/bootstrap-admin';

const fresh = () => { const db = createDb(':memory:'); seedPlatform(db); return db; };
const staff = (db: ReturnType<typeof fresh>) => db.select({ c: count() }).from(platformStaff).get()!.c;

describe('bootstrapAdmin (first start on hosts without a terminal)', () => {
  it('does nothing without ADMIN_EMAIL / ADMIN_PASSWORD', async () => {
    const db = fresh(); expect(await bootstrapAdmin(db, {})).toBe('skipped'); expect(staff(db)).toBe(0);
  });
  it('creates the first super admin when none exists', async () => {
    const db = fresh(); expect(await bootstrapAdmin(db, { ADMIN_EMAIL: 'boss@codela.tech', ADMIN_PASSWORD: 'Str0ng-Pass!2026' })).toBe('created'); expect(staff(db)).toBe(1);
  });
  it('never creates or changes anyone once an admin exists (so leaving the variables set is harmless)', async () => {
    const db = fresh(); await bootstrapAdmin(db, { ADMIN_EMAIL: 'boss@codela.tech', ADMIN_PASSWORD: 'Str0ng-Pass!2026' });
    expect(await bootstrapAdmin(db, { ADMIN_EMAIL: 'other@codela.tech', ADMIN_PASSWORD: 'Another-Pass!2026' })).toBe('exists'); expect(staff(db)).toBe(1);
  });
});
