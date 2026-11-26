import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';

const reg = (slug: string, productSlug = 'medical') => ({ businessName: `Biz ${slug}`, slug, productSlug, name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000 }); });

async function signup(slug: string, productSlug = 'medical') {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register-business').send(reg(slug, productSlug));
  expect(r.status).toBe(201);
  const csrf = r.body.data.csrfToken as string;
  return { agent, csrf, tenantId: r.body.data.tenant.id as string,
    post: (u: string, b: object = {}) => agent.post(u).set('x-csrf-token', csrf).send(b),
    del: (u: string) => agent.delete(u).set('x-csrf-token', csrf) };
}
const emp = (i: number) => ({ name: `Emp ${i}`, email: `e${i}@x.test`, password: 'Emp-Pass-1234!', role: 'employee' });

describe('seed', () => {
  it('seeds 10 products x 3 plans and add-ons, idempotently', () => {
    seedPlatform(db);
    expect((db.$client.prepare('select count(*) c from products').get() as { c: number }).c).toBe(10);
    expect((db.$client.prepare('select count(*) c from plans').get() as { c: number }).c).toBe(30);
    expect((db.$client.prepare('select count(*) c from add_ons').get() as { c: number }).c).toBeGreaterThan(5);
  });
});

describe('subscription on registration', () => {
  it('new tenant starts a Starter trial with read of limits', async () => {
    const t = await signup('alpha');
    const r = await t.agent.get('/api/v1/tenant/subscription');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('trialing');
    expect(r.body.data.plan.tier).toBe('starter');
    expect(r.body.data.access).toBe('full');
    expect(r.body.data.limits.maxEmployees).toBeGreaterThan(0);
  });
  it('expired trial -> read-only: reads work, writes 402, data kept', async () => {
    const t = await signup('alpha');
    await t.post('/api/v1/tenant/customers', { name: 'Keep Me', ref: 'C1' });
    db.$client.prepare("update subscriptions set trial_ends_at='2000-01-01T00:00:00.000Z'").run();
    const list = await t.agent.get('/api/v1/tenant/customers');
    expect(list.status).toBe(200); expect(list.body.data).toHaveLength(1);
    const w = await t.post('/api/v1/tenant/customers', { name: 'New', ref: 'C2' });
    expect(w.status).toBe(402); expect(w.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    expect((await t.agent.get('/api/v1/tenant/subscription')).body.data.status).toBe('expired');
  });
  it('sandbox activation makes it active and writable again', async () => {
    const t = await signup('alpha');
    db.$client.prepare("update subscriptions set trial_ends_at='2000-01-01T00:00:00.000Z'").run();
    await t.agent.get('/api/v1/tenant/subscription');
    const a = await t.post('/api/v1/tenant/subscription/activate', { billingPeriod: 'annual' });
    expect(a.status).toBe(200); expect(a.body.data.status).toBe('active'); expect(a.body.data.simulated).toBe(true);
    expect((await t.post('/api/v1/tenant/customers', { name: 'N', ref: 'C3' })).status).toBe(201);
  });
  it('cancel at period end', async () => {
    const t = await signup('alpha');
    await t.post('/api/v1/tenant/subscription/activate', { billingPeriod: 'monthly' });
    const c = await t.post('/api/v1/tenant/subscription/cancel', { atPeriodEnd: true });
    expect(c.status).toBe(200); expect(c.body.data.cancelAtPeriodEnd).toBe(true); expect(c.body.data.status).toBe('active');
  });
});

describe('entitlements enforced on the backend', () => {
  it('employee limit of the plan', async () => {
    const t = await signup('alpha');
    const max = (await t.agent.get('/api/v1/tenant/subscription')).body.data.limits.maxEmployees as number;
    for (let i = 1; i < max; i++) expect((await t.post('/api/v1/tenant/employees', emp(i))).status).toBe(201); // owner counts as 1
    const over = await t.post('/api/v1/tenant/employees', emp(99));
    expect(over.status).toBe(403); expect(over.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
  it('record limit', async () => {
    const t = await signup('alpha');
    db.$client.prepare(`update plans set limits=json_set(limits,'$.maxRecords',1)`).run();
    expect((await t.post('/api/v1/tenant/customers', { name: 'A', ref: 'C1' })).status).toBe(201);
    const o = await t.post('/api/v1/tenant/customers', { name: 'B', ref: 'C2' });
    expect(o.status).toBe(403); expect(o.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
  it('upgrade raises the limit; downgrade blocked when usage exceeds new plan', async () => {
    const t = await signup('alpha');
    expect((await t.post('/api/v1/tenant/subscription/change-plan', { tier: 'business' })).status).toBe(200);
    for (let i = 1; i <= 5; i++) expect((await t.post('/api/v1/tenant/employees', emp(i))).status).toBe(201);
    const down = await t.post('/api/v1/tenant/subscription/change-plan', { tier: 'starter' });
    expect(down.status).toBe(409); expect(down.body.error.code).toBe('DOWNGRADE_BLOCKED');
  });
  it('employee without subscription.manage cannot change plan', async () => {
    const t = await signup('alpha');
    await t.post('/api/v1/tenant/employees', emp(1));
    const e = request.agent(app);
    const l = await e.post('/api/v1/auth/login').send({ email: 'e1@x.test', password: 'Emp-Pass-1234!' });
    const r = await e.post('/api/v1/tenant/subscription/change-plan').set('x-csrf-token', l.body.data.csrfToken).send({ tier: 'business' });
    expect(r.status).toBe(403);
  });
});

describe('add-ons marketplace', () => {
  it('lists only compatible add-ons', async () => {
    const med = await signup('med', 'medical');
    const rest = await signup('rest', 'restaurant');
    const m = (await med.agent.get('/api/v1/tenant/addons')).body.data.map((a: { key: string }) => a.key);
    const r = (await rest.agent.get('/api/v1/tenant/addons')).body.data.map((a: { key: string }) => a.key);
    expect(m).toContain('extra_employees'); expect(m).not.toContain('kitchen_display_pro');
    expect(r).toContain('kitchen_display_pro');
  });
  it('incompatible add-on cannot be activated', async () => {
    const med = await signup('med', 'medical');
    expect((await med.post('/api/v1/tenant/addons/kitchen_display_pro/activate')).status).toBe(404);
  });
  it('extra_employees add-on raises employee limit; cancel removes it', async () => {
    const t = await signup('alpha');
    const before = (await t.agent.get('/api/v1/tenant/subscription')).body.data.limits.maxEmployees as number;
    expect((await t.post('/api/v1/tenant/addons/extra_employees/activate')).status).toBe(200);
    expect((await t.agent.get('/api/v1/tenant/subscription')).body.data.limits.maxEmployees).toBeGreaterThan(before);
    expect((await t.post('/api/v1/tenant/addons/extra_employees/activate')).status).toBe(409);
    expect((await t.post('/api/v1/tenant/addons/extra_employees/cancel')).status).toBe(200);
    expect((await t.agent.get('/api/v1/tenant/subscription')).body.data.limits.maxEmployees).toBe(before);
  });
  it("one tenant's add-ons never affect another", async () => {
    const a = await signup('alpha'); const b = await signup('beta');
    await a.post('/api/v1/tenant/addons/extra_employees/activate');
    const lim = (await b.agent.get('/api/v1/tenant/subscription')).body.data.limits.maxEmployees as number;
    const lim2 = (await a.agent.get('/api/v1/tenant/subscription')).body.data.limits.maxEmployees as number;
    expect(lim2).toBeGreaterThan(lim);
  });
});

describe('global search', () => {
  async function seeded() {
    const t = await signup('alpha');
    await t.post('/api/v1/tenant/customers', { name: 'Ahmed Hassan', ref: 'C-100', phone: '01001234567', email: 'ahmed@mail.test' });
    await t.post('/api/v1/tenant/customers', { name: 'Mona Said', ref: 'C-200', phone: '01112223334' });
    return t;
  }
  const names = (r: request.Response) => r.body.data.map((x: { title: string }) => x.title);
  it('partial name, case-insensitive', async () => { const t = await seeded(); expect(names(await t.agent.get('/api/v1/search?q=hass'))).toEqual(['Ahmed Hassan']); expect(names(await t.agent.get('/api/v1/search?q=MONA'))).toEqual(['Mona Said']); });
  it('phone, email, reference, exact id', async () => {
    const t = await seeded();
    expect(names(await t.agent.get('/api/v1/search?q=0100123'))).toEqual(['Ahmed Hassan']);
    expect(names(await t.agent.get('/api/v1/search?q=ahmed@mail.test'))).toEqual(['Ahmed Hassan']);
    expect(names(await t.agent.get('/api/v1/search?q=c-200'))).toEqual(['Mona Said']);
    const id = (await t.agent.get('/api/v1/tenant/customers')).body.data[0].id as string;
    expect((await t.agent.get(`/api/v1/search?q=${id}`)).body.data).toHaveLength(1);
  });
  it('arabic-indic digits match latin phone', async () => { const t = await seeded(); expect(names(await t.agent.get('/api/v1/search?q=' + encodeURIComponent('٠١٠٠١٢٣')))).toEqual(['Ahmed Hassan']); });
  it('wildcards are literal', async () => { const t = await seeded(); expect((await t.agent.get('/api/v1/search?q=%25')).body.data).toEqual([]); expect((await t.agent.get('/api/v1/search?q=_')).body.data).toEqual([]); });
  it('tenant isolation', async () => {
    const a = await seeded(); const b = await signup('beta');
    expect((await b.agent.get('/api/v1/search?q=ahmed')).body.data).toEqual([]);
    expect((await a.agent.get('/api/v1/search?q=ahmed')).body.data).toHaveLength(1);
  });
  it('update and delete keep index in sync', async () => {
    const t = await seeded();
    const id = (await t.agent.get('/api/v1/tenant/customers')).body.data[0].id as string;
    await t.agent.patch(`/api/v1/tenant/customers/${id}`).set('x-csrf-token', t.csrf).send({ name: 'Zed Renamed' });
    expect(names(await t.agent.get('/api/v1/search?q=zed'))).toEqual(['Zed Renamed']);
    expect((await t.agent.get('/api/v1/search?q=hassan')).body.data).toEqual([]); // old name gone (email still contains 'ahmed' by design)
    await t.del(`/api/v1/tenant/customers/${id}`);
    expect((await t.agent.get('/api/v1/search?q=zed')).body.data).toEqual([]);
  });
  it('pagination + validation + auth', async () => {
    const t = await signup('alpha');
    for (let i = 0; i < 5; i++) await t.post('/api/v1/tenant/customers', { name: `Test ${i}`, ref: `T${i}` });
    const p = await t.agent.get('/api/v1/search?q=test&pageSize=2&page=2');
    expect(p.body.data).toHaveLength(2); expect(p.body.meta.total).toBe(5);
    expect((await t.agent.get('/api/v1/search?q=')).status).toBe(400);
    expect((await request(app).get('/api/v1/search?q=a')).status).toBe(401);
  });
});

describe('notifications (in-app)', () => {
  it('owner gets an in-app welcome notification, can mark read; isolated per tenant', async () => {
    const a = await signup('alpha'); const b = await signup('beta');
    const l = await a.agent.get('/api/v1/tenant/notifications');
    expect(l.body.data.length).toBeGreaterThan(0); expect(l.body.data[0].readAt).toBeNull();
    const id = l.body.data[0].id as string;
    expect((await b.agent.post(`/api/v1/tenant/notifications/${id}/read`).set('x-csrf-token', b.csrf)).status).toBe(404);
    expect((await a.post(`/api/v1/tenant/notifications/${id}/read`)).status).toBe(200);
    expect((await a.agent.get('/api/v1/tenant/notifications')).body.data[0].readAt).not.toBeNull();
  });
});
