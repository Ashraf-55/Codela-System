import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { createPlatformStaff } from '../src/platform-admin';

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000 }); });

async function tenant(slug: string, productSlug = 'medical') {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register-business').send({ businessName: `Biz ${slug}`, slug, productSlug, name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });
  const csrf = r.body.data.csrfToken as string;
  return { agent, csrf, id: r.body.data.tenant.id as string, post: (u: string, b: object = {}) => agent.post(u).set('x-csrf-token', csrf).send(b) };
}
async function staff(role: 'super_admin' | 'support' | 'finance', email = `${role}@codela.test`) {
  await createPlatformStaff(db, { email, password: 'Admin-Pass-12345', name: `Staff ${role}`, role, department: 'management' });
  const agent = request.agent(app);
  const l = await agent.post('/api/v1/platform/auth/login').send({ email, password: 'Admin-Pass-12345' });
  expect(l.status).toBe(200);
  const csrf = l.body.data.csrfToken as string;
  const w = (m: 'post' | 'patch' | 'put' | 'delete', u: string, b: object = {}) => agent[m](u).set('x-csrf-token', csrf).send(b);
  return { agent, csrf, post: (u: string, b?: object) => w('post', u, b), patch: (u: string, b?: object) => w('patch', u, b) };
}

describe('platform auth separation', () => {
  it('tenant users cannot log in to the platform; staff cannot use tenant endpoints', async () => {
    await tenant('alpha');
    expect((await request(app).post('/api/v1/platform/auth/login').send({ email: 'o@alpha.test', password: 'Str0ng-Pass!1' })).status).toBe(401);
    const s = await staff('super_admin');
    expect((await s.agent.get('/api/v1/tenant/customers')).status).toBe(401);
    expect((await s.agent.get('/api/v1/platform/me')).body.data.role).toBe('super_admin');
  });
  it('tenant session cannot reach /platform', async () => {
    const t = await tenant('alpha');
    expect((await t.agent.get('/api/v1/platform/tenants')).status).toBe(401);
  });
  it('unauthenticated and csrf', async () => {
    expect((await request(app).get('/api/v1/platform/tenants')).status).toBe(401);
    const s = await staff('super_admin');
    expect((await s.agent.post('/api/v1/platform/staff').send({})).status).toBe(403);
  });
  it('createPlatformStaff rejects weak password / unknown role', async () => {
    await expect(createPlatformStaff(db, { email: 'x@y.co', password: 'short', name: 'X', role: 'super_admin', department: 'management' })).rejects.toThrow();
    await expect(createPlatformStaff(db, { email: 'x@y.co', password: 'Admin-Pass-12345', name: 'X', role: 'nope' as never, department: 'management' })).rejects.toThrow();
  });
});

describe('tenant management', () => {
  it('list/search/filter/paginate tenants', async () => {
    await tenant('alpha'); await tenant('beta', 'restaurant'); await tenant('gamma');
    const s = await staff('support');
    const all = await s.agent.get('/api/v1/platform/tenants');
    expect(all.body.meta.total).toBe(3);
    expect((await s.agent.get('/api/v1/platform/tenants?q=bet')).body.data.map((t: { slug: string }) => t.slug)).toEqual(['beta']);
    expect((await s.agent.get('/api/v1/platform/tenants?product=restaurant')).body.meta.total).toBe(1);
    expect((await s.agent.get('/api/v1/platform/tenants?pageSize=2&page=2')).body.data).toHaveLength(1);
    expect(all.body.data[0].subscriptionStatus).toBe('trialing');
    expect(JSON.stringify(all.body)).not.toContain('passwordHash');
  });
  it('suspend blocks the tenant immediately, activate restores; support cannot suspend', async () => {
    const t = await tenant('alpha'); const sup = await staff('support'); const adm = await staff('super_admin');
    expect((await sup.patch(`/api/v1/platform/tenants/${t.id}/status`, { status: 'suspended' })).status).toBe(403);
    expect((await adm.patch(`/api/v1/platform/tenants/${t.id}/status`, { status: 'suspended' })).status).toBe(200);
    const blocked = await t.agent.get('/api/v1/tenant/customers');
    expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'o@alpha.test', password: 'Str0ng-Pass!1' })).status).toBe(403);
    await adm.patch(`/api/v1/platform/tenants/${t.id}/status`, { status: 'active' });
    expect((await t.agent.get('/api/v1/tenant/customers')).status).toBe(200);
    expect((await adm.patch(`/api/v1/platform/tenants/${t.id}/status`, { status: 'weird' })).status).toBe(400);
    expect((await adm.patch(`/api/v1/platform/tenants/nope/status`, { status: 'active' })).status).toBe(404);
  });
  it('tenant detail includes subscription and usage', async () => {
    const t = await tenant('alpha'); const s = await staff('support');
    const d = await s.agent.get(`/api/v1/platform/tenants/${t.id}`);
    expect(d.status).toBe(200); expect(d.body.data.subscription.plan.tier).toBe('starter'); expect(d.body.data.usage.maxEmployees).toBe(1);
  });
});

describe('plans, products, add-ons (configurable, not hardcoded)', () => {
  it('finance edits plan price/limits and tenants see the change', async () => {
    const t = await tenant('alpha'); const f = await staff('finance');
    const plans = (await f.agent.get('/api/v1/platform/plans?productSlug=medical')).body.data;
    expect(plans).toHaveLength(3);
    const starter = plans.find((p: { tier: string }) => p.tier === 'starter');
    const r = await f.patch(`/api/v1/platform/plans/${starter.id}`, { priceMonthly: 59900, trialDays: 30, limits: { ...starter.limits, maxEmployees: 7 } });
    expect(r.status).toBe(200);
    const sub = await t.agent.get('/api/v1/tenant/subscription');
    expect(sub.body.data.limits.maxEmployees).toBe(7); expect(sub.body.data.plan.priceMonthly).toBe(59900);
  });
  it('rejects non-integer/negative prices (no floats) and support role', async () => {
    const f = await staff('finance'); const sup = await staff('support');
    const p = (await f.agent.get('/api/v1/platform/plans?productSlug=medical')).body.data[0];
    expect((await f.patch(`/api/v1/platform/plans/${p.id}`, { priceMonthly: 10.5 })).status).toBe(400);
    expect((await f.patch(`/api/v1/platform/plans/${p.id}`, { priceMonthly: -1 })).status).toBe(400);
    expect((await sup.patch(`/api/v1/platform/plans/${p.id}`, { priceMonthly: 100 })).status).toBe(403);
  });
  it('admin toggles product and manages add-ons', async () => {
    const a = await staff('super_admin');
    expect((await a.patch('/api/v1/platform/products/medical', { status: 'inactive' })).status).toBe(200);
    const reg = await request(app).post('/api/v1/auth/register-business').send({ businessName: 'X Co', slug: 'xco', productSlug: 'medical', name: 'Owner', email: 'o@x.test', password: 'Str0ng-Pass!1' });
    expect(reg.status).toBe(400); // inactive product cannot be subscribed to
    await a.patch('/api/v1/platform/products/medical', { status: 'active' });
    const c = await a.post('/api/v1/platform/addons', { key: 'priority_support', nameAr: 'دعم أولوية', nameEn: 'Priority support', priceMinor: 9900, billingType: 'recurring', compatibleProducts: '*', grants: { prioritySupport: true } });
    expect(c.status).toBe(201);
    const t = await tenant('alpha');
    expect((await t.agent.get('/api/v1/tenant/addons')).body.data.map((x: { key: string }) => x.key)).toContain('priority_support');
    await a.patch('/api/v1/platform/addons/priority_support', { active: false });
    expect((await t.agent.get('/api/v1/tenant/addons')).body.data.map((x: { key: string }) => x.key)).not.toContain('priority_support');
  });
});

describe('analytics from real subscription data', () => {
  it('MRR/ARR/counts are computed exactly with integer math', async () => {
    const a = await tenant('alpha'); const b = await tenant('beta'); await tenant('gamma');
    await a.post('/api/v1/tenant/subscription/activate', { billingPeriod: 'monthly' });          // starter monthly 49900
    await b.post('/api/v1/tenant/subscription/change-plan', { tier: 'professional' });
    await b.post('/api/v1/tenant/subscription/activate', { billingPeriod: 'annual' });           // pro annual 1299000 -> 108250/mo
    const s = await staff('finance');
    const r = await s.agent.get('/api/v1/platform/analytics');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.tenants.total).toBe(3); expect(d.subscriptions.active).toBe(2); expect(d.subscriptions.trialing).toBe(1);
    expect(d.revenue.EGP.mrr).toBe(49900 + 108250); expect(d.revenue.EGP.arr).toBe(49900 * 12 + 1299000);
    expect(d.byProduct.medical.EGP.mrr).toBe(158150);
    expect(d.byPlan.starter.count).toBe(2); expect(d.byPlan.professional.count).toBe(1);
    expect(d.simulated).toBe(true); // based on sandbox activations until a real gateway is connected
  });
  it('canceled/expired do not count toward MRR; support role may read revenue', async () => {
    const a = await tenant('alpha'); await a.post('/api/v1/tenant/subscription/activate', { billingPeriod: 'monthly' });
    await a.post('/api/v1/tenant/subscription/cancel', { atPeriodEnd: false });
    const s = await staff('support');
    expect((await s.agent.get('/api/v1/platform/analytics')).body.data.revenue.EGP?.mrr ?? 0).toBe(0);
  });
});

describe('staff & audit', () => {
  it('only super_admin creates staff; audit trail visible; departments validated', async () => {
    const adm = await staff('super_admin'); const sup = await staff('support');
    const body = { email: 'new@codela.test', password: 'Admin-Pass-12345', name: 'New Dev', role: 'support', department: 'development' };
    expect((await sup.post('/api/v1/platform/staff', body)).status).toBe(403);
    expect((await adm.post('/api/v1/platform/staff', body)).status).toBe(201);
    expect((await adm.post('/api/v1/platform/staff', { ...body, email: 'n2@codela.test', department: 'cooking' })).status).toBe(400);
    expect((await adm.post('/api/v1/platform/staff', body)).status).toBe(409);
    const logs = await sup.agent.get('/api/v1/platform/audit-logs');
    expect(logs.body.data.map((x: { action: string }) => x.action)).toContain('platform.staff.created');
  });
});
