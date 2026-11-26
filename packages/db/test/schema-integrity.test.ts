import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/client';

/** Structural audit of the real, migrated schema (see docs/DATABASE_AUDIT.md). Fails when a new table or foreign key ships without the index it needs. */
const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const raw = createDb(':memory:').$client;
const tables = (raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_drizzle%' escape '\\'").all() as { name: string }[]).map((t) => t.name);
const indexes = (t: string) => (raw.prepare(`pragma index_list("${t}")`).all() as { name: string }[]).map((i) => (raw.prepare(`pragma index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name));
const columns = (t: string) => (raw.prepare(`pragma table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);

// Deliberate exceptions, each with the reason: global (platform-level) tables have no tenant; rare lookups are not worth an index.
const NO_TENANT = new Set(['tenants', 'users', 'plans', 'products', 'add_ons', 'platform_settings', 'platform_staff', 'webhook_events', 'leads', 'internal_tasks', 'role_permissions']);
const FK_NOT_INDEXED = new Set(['internal_tasks.created_by', 'tenant_add_ons.add_on_key']);

describe('schema integrity', () => {
  it('the migration journal and the SQL files match one to one', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
    for (const e of journal.entries) expect(existsSync(path.join(MIGRATIONS, `${e.tag}.sql`)), e.tag).toBe(true);
    expect(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length).toBe(journal.entries.length);
  });
  it('has no dangling foreign keys', () => { expect(raw.prepare('pragma foreign_key_check').all()).toEqual([]); });
  it('every tenant-owned table has an index that starts with tenant_id', () => {
    for (const t of tables) { if (!columns(t).includes('tenant_id') || NO_TENANT.has(t)) continue; expect(indexes(t).some((c) => c[0] === 'tenant_id'), `${t} needs an index starting with tenant_id`).toBe(true); }
  });
  it('every foreign key column is the first column of some index (deletes / cascades never scan a table)', () => {
    for (const t of tables) for (const fk of raw.prepare(`pragma foreign_key_list("${t}")`).all() as { from: string }[]) {
      if (FK_NOT_INDEXED.has(`${t}.${fk.from}`)) continue; expect(indexes(t).some((c) => c[0] === fk.from), `${t}.${fk.from} needs an index`).toBe(true);
    }
  });
  it('foreign keys are enforced', () => { expect(raw.pragma('foreign_keys', { simple: true })).toBe(1); });
});
