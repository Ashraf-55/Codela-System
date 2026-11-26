import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createDb, seedPlatform, tenants } from '@codela/db';
import { createApp } from '../src/app';
import { backupDatabase } from '../src/backup';

describe('backup', () => {
  it('writes a consistent, integrity-checked copy and keeps only the newest N', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codela-bk-')); const file = path.join(dir, 'live.db'); const db = createDb(file); seedPlatform(db);
    db.insert(tenants).values({ slug: 'bk', name: 'Backup Co', productSlug: 'medical', status: 'active' }).run();
    const out = path.join(dir, 'backups');
    for (let i = 0; i < 4; i++) await backupDatabase(file, out, 2, new Date(Date.UTC(2030, 0, 1, 0, 0, i)));
    expect(readdirSync(out).sort()).toEqual(['codela-20300101-000002.db', 'codela-20300101-000003.db']);
    const copy = new Database(path.join(out, 'codela-20300101-000003.db'), { readonly: true });
    expect((copy.prepare("select name from tenants where slug = 'bk'").get() as { name: string }).name).toBe('Backup Co'); copy.close();
  });
  it('readiness endpoint answers when the database works', async () => {
    const db = createDb(':memory:'); seedPlatform(db); const app = createApp({ db, secureCookies: false });
    const r = await request(app).get('/api/v1/ready'); expect(r.status).toBe(200); expect(r.body.data.status).toBe('ready');
  });
});
