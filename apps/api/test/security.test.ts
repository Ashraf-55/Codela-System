import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { PRODUCTS } from '../src/products/registry';
import { setup, tenantClient } from './_helpers';

describe('authentication is required everywhere it should be', () => {
  const { app } = setup();
  const GET = ['/tenant/p-meta', '/tenant/dashboard', '/tenant/reports/x', '/tenant/subscription', '/tenant/site', '/tenant/domains', '/tenant/employees', '/tenant/settings', '/tenant/outbox', '/tenant/billing/invoices', '/tenant/audit-logs', '/tenant/notifications',
    '/tenant/addons', '/tenant/p/patient', '/tenant/p/patient/x', '/search?q=a', '/auth/me', '/platform/me', '/platform/tenants', '/platform/tenants/x', '/platform/analytics', '/platform/plans', '/platform/products', '/platform/addons', '/platform/leads', '/platform/leads/pipeline',
    '/platform/tasks', '/platform/settings/company', '/platform/audit-logs'];
  for (const p of GET) it(`GET ${p} -> 401 without a session`, async () => { expect((await request(app).get(`/api/v1${p}`)).status).toBe(401); });
  const WRITE: [string, string][] = [['post', '/tenant/p/patient'], ['patch', '/tenant/p/patient/x'], ['delete', '/tenant/p/patient/x'], ['post', '/tenant/employees'], ['put', '/tenant/site'], ['post', '/tenant/domains'], ['patch', '/tenant/settings'], ['post', '/tenant/subscription/checkout'],
    ['post', '/tenant/subscription/activate'], ['post', '/platform/staff'], ['patch', '/platform/plans/x'], ['patch', '/platform/tenants/x/status'], ['post', '/platform/addons'], ['post', '/platform/leads']];
  for (const [m, p] of WRITE) it(`${m.toUpperCase()} ${p} -> 401 without a session`, async () => { expect((await (request(app) as any)[m](`/api/v1${p}`).send({})).status).toBe(401); });
  it('forged / garbage cookies are rejected', async () => {
    for (const c of ['sid=forged', 'sid=', 'psid=forged', `sid=${'a'.repeat(64)}`]) { expect((await request(app).get('/api/v1/tenant/p-meta').set('Cookie', c)).status).toBe(401); expect((await request(app).get('/api/v1/platform/me').set('Cookie', c)).status).toBe(401); }
  });
  it('public endpoints are the only anonymous surface: unknown host has no data', async () => {
    for (const p of ['/public/site', '/public/site-meta', '/public/catalog/doctor', '/public/actions/track']) expect([404, 400]).toContain((await request(app).get(`/api/v1${p}`).set('Host', 'nobody.codela.test')).status);
  });
});

describe('global rate limit', () => {
  it('returns 429 with a JSON error after the limit', async () => {
    const db = createDb(':memory:'); seedPlatform(db); const app = createApp({ db, secureCookies: false, globalRateLimitMax: 5 });
    const codes: number[] = []; for (let i = 0; i < 8; i++) codes.push((await request(app).get('/api/v1/public/products')).status);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true); expect(codes.at(-1)).toBe(429); expect((await request(app).get('/api/v1/public/products')).body.error.code).toBe('RATE_LIMITED');
  });
});

/** Generic cross-tenant sweep: every creatable entity of every product must be invisible and immutable for another tenant. */
type F = { type: string; required: boolean; readonly: boolean; values?: string[] };
const sample = (f: F): unknown => ({ string: 'Test value', text: 'Some text', email: 'a@b.co', phone: '01001234567', url: 'https://x.co/a', date: '2030-01-01', time: '10:00', datetime: '2030-01-01T10:00:00.000Z', int: 1, money: 1000, bool: true }[f.type] ?? (f.type === 'enum' ? f.values![0] : undefined));
describe('tenant isolation holds for every entity of every product', () => {
  it('cannot read, edit, delete or list another tenant\'s records', async () => {
    const { app } = setup(); let checked = 0; const covered = new Set<string>();
    for (const slug of Object.keys(PRODUCTS)) {
      const A = await tenantClient(app, `a-${slug}`, slug); const B = await tenantClient(app, `b-${slug}`, slug);
      const meta = (await A.agent.get('/api/v1/tenant/p-meta')).body.data.entities as { key: string; canCreate: boolean; fields: Record<string, F> }[];
      for (const e of meta) {
        const req = Object.entries(e.fields).filter(([, f]) => f.required && !f.readonly);
        if (req.some(([, f]) => f.type === 'ref' || f.type === 'lines')) continue;
        const body = Object.fromEntries(req.map(([k, f]) => [k, sample(f)])); const c = await A.create(e.key, body);
        if (c.status !== 201) continue; const id = c.body.data.id as string; checked++; covered.add(slug);
        expect((await B.get(e.key, id)).status, `${slug}/${e.key} GET`).toBe(404);
        expect((await B.list(e.key)).body.meta.total, `${slug}/${e.key} list`).toBe(0);
        const strField = Object.entries(e.fields).find(([, f]) => !f.readonly && f.type === 'string')?.[0];
        if (strField) expect([404, 405], `${slug}/${e.key} PATCH`).toContain((await B.patch(e.key, id, { [strField]: 'Hacked' })).status); // 405 = entity is append-only; never a 2xx
        expect([404, 405]).toContain((await B.del(e.key, id)).status);
        expect((await A.get(e.key, id)).status, `${slug}/${e.key} owner still reads`).toBe(200);
      }
    }
    expect(covered.size).toBe(Object.keys(PRODUCTS).length); expect(checked).toBeGreaterThan(40);
  }, 120_000);
});
