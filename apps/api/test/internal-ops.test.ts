import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { createPlatformStaff } from '../src/platform-admin';

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000 }); });
async function staff(role: 'super_admin' | 'support' | 'finance' | 'sales') {
  await createPlatformStaff(db, { email: `${role}@codela.test`, password: 'Admin-Pass-12345', name: `S ${role}`, role, department: role === 'sales' ? 'sales' : 'management' });
  const agent = request.agent(app);
  const l = await agent.post('/api/v1/platform/auth/login').send({ email: `${role}@codela.test`, password: 'Admin-Pass-12345' });
  const csrf = l.body.data.csrfToken as string;
  return { agent, id: (await agent.get('/api/v1/platform/me')).body.data.userId as string,
    post: (u: string, b: object = {}) => agent.post(u).set('x-csrf-token', csrf).send(b),
    patch: (u: string, b: object = {}) => agent.patch(u).set('x-csrf-token', csrf).send(b),
    put: (u: string, b: object = {}) => agent.put(u).set('x-csrf-token', csrf).send(b),
    del: (u: string) => agent.delete(u).set('x-csrf-token', csrf) };
}
const lead = { name: 'Dr. Sara', email: 'sara@clinic.test', phone: '01001112223', company: 'Sara Clinic', productSlug: 'medical', message: 'Need a demo', kind: 'demo_request' };

describe('public lead capture', () => {
  it('creates a lead without auth; validates; honeypot silently ignored', async () => {
    expect((await request(app).post('/api/v1/public/leads').send(lead)).status).toBe(201);
    expect((await request(app).post('/api/v1/public/leads').send({ ...lead, email: 'bad' })).status).toBe(400);
    expect((await request(app).post('/api/v1/public/leads').send({ ...lead, kind: 'hack' })).status).toBe(400);
    expect((await request(app).post('/api/v1/public/leads').send({ name: 'No contact', kind: 'contact' })).status).toBe(400); // needs email or phone
    const bot = await request(app).post('/api/v1/public/leads').send({ ...lead, website: 'http://spam' });
    expect(bot.status).toBe(201);
    expect((db.$client.prepare('select count(*) c from leads').get() as { c: number }).c).toBe(1);
  });
  it('is rate limited', async () => {
    const limited = createApp({ db, secureCookies: false, publicFormRateLimitMax: 2 });
    for (let i = 0; i < 2; i++) expect((await request(limited).post('/api/v1/public/leads').send(lead)).status).toBe(201);
    expect((await request(limited).post('/api/v1/public/leads').send(lead)).status).toBe(429);
  });
});

describe('sales pipeline', () => {
  it('sales staff manage leads; support is read-only; finance has no access', async () => {
    await request(app).post('/api/v1/public/leads').send(lead);
    const sales = await staff('sales'); const sup = await staff('support'); const fin = await staff('finance');
    const list = await sales.agent.get('/api/v1/platform/leads');
    expect(list.body.meta.total).toBe(1); const id = list.body.data[0].id;
    expect(list.body.data[0].stage).toBe('new'); expect(list.body.data[0].source).toBe('demo_request');
    expect((await sup.agent.get('/api/v1/platform/leads')).status).toBe(200);
    expect((await sup.patch(`/api/v1/platform/leads/${id}`, { stage: 'contacted' })).status).toBe(403);
    expect((await fin.agent.get('/api/v1/platform/leads')).status).toBe(403);
    const u = await sales.patch(`/api/v1/platform/leads/${id}`, { stage: 'contacted', notes: 'called', ownerId: sales.id });
    expect(u.status).toBe(200); expect(u.body.data.stage).toBe('contacted');
    expect((await sales.patch(`/api/v1/platform/leads/${id}`, { stage: 'nonsense' })).status).toBe(400);
    expect((await sales.patch(`/api/v1/platform/leads/${id}`, { ownerId: 'ghost' })).status).toBe(400);
    expect((await sales.patch(`/api/v1/platform/leads/nope`, { stage: 'won' })).status).toBe(404);
  });
  it('manual lead, filters, pipeline summary and conversion rate', async () => {
    const s = await staff('sales');
    for (const [n, st] of [['A', 'won'], ['B', 'won'], ['C', 'lost'], ['D', 'new'], ['E', 'proposal']] as const) {
      const r = await s.post('/api/v1/platform/leads', { name: n, email: `${n.toLowerCase()}@x.test`, productSlug: 'restaurant' });
      expect(r.status).toBe(201); await s.patch(`/api/v1/platform/leads/${r.body.data.id}`, { stage: st });
    }
    expect((await s.agent.get('/api/v1/platform/leads?stage=won')).body.meta.total).toBe(2);
    expect((await s.agent.get('/api/v1/platform/leads?q=c@x')).body.data).toHaveLength(1);
    const p = (await s.agent.get('/api/v1/platform/leads/pipeline')).body.data;
    expect(p.stages.won).toBe(2); expect(p.stages.new).toBe(1); expect(p.total).toBe(5);
    expect(p.conversionRate).toBeCloseTo(2 / 3, 5); // won / (won + lost)
  });
});

describe('internal tasks', () => {
  it('create, assign, move status, filter by department; viewers cannot create', async () => {
    const s = await staff('sales'); const sup = await staff('support');
    const t = await s.post('/api/v1/platform/tasks', { title: 'Call Dr. Sara', department: 'sales', assigneeId: s.id, dueDate: '2026-12-01' });
    expect(t.status).toBe(201);
    expect((await s.post('/api/v1/platform/tasks', { title: 'x', department: 'cooking' })).status).toBe(400);
    expect((await sup.post('/api/v1/platform/tasks', { title: 'x', department: 'sales' })).status).toBe(403);
    expect((await sup.agent.get('/api/v1/platform/tasks?department=sales')).body.data).toHaveLength(1);
    expect((await s.patch(`/api/v1/platform/tasks/${t.body.data.id}`, { status: 'done' })).body.data.status).toBe('done');
    expect((await s.patch(`/api/v1/platform/tasks/${t.body.data.id}`, { status: 'bogus' })).status).toBe(400);
    expect((await s.agent.get('/api/v1/platform/tasks?department=development')).body.data).toEqual([]);
  });
});

describe('platform settings', () => {
  it('only super admin writes; whitelisted keys; secrets rejected', async () => {
    const a = await staff('super_admin'); const f = await staff('finance');
    expect((await a.put('/api/v1/platform/settings/company', { value: { name: 'Codela Technology', supportEmail: 'help@codela.tech' } })).status).toBe(200);
    expect((await f.put('/api/v1/platform/settings/company', { value: { name: 'x' } })).status).toBe(403);
    expect((await f.agent.get('/api/v1/platform/settings/company')).body.data.value.name).toBe('Codela Technology');
    expect((await a.put('/api/v1/platform/settings/unknownkey', { value: {} })).status).toBe(400);
    expect((await a.put('/api/v1/platform/settings/payment', { value: { provider: 'paymob', apiKey: 'sk_live_123' } })).status).toBe(400);
    expect((await a.put('/api/v1/platform/settings/payment', { value: { provider: 'paymob', mode: 'sandbox' } })).status).toBe(200);
    expect((await a.agent.get('/api/v1/platform/settings/localization')).body.data.value).toEqual({});
  });
});
