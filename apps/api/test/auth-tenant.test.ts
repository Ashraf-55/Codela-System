import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';

const A = { businessName: 'Alpha Clinic', slug: 'alpha', productSlug: 'medical', name: 'Ali', email: 'ali@alpha.test', password: 'Str0ng-Pass!1' };
const B = { businessName: 'Beta Clinic', slug: 'beta', productSlug: 'medical', name: 'Omar', email: 'omar@beta.test', password: 'Str0ng-Pass!2' };

function setup() {
  const db = createDb(':memory:');
  seedPlatform(db);
  return { db, app: createApp({ db, secureCookies: false }) };
}
/** Register and return an agent + csrf token. */
async function signup(app: ReturnType<typeof createApp>, body: typeof A) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register-business').send(body);
  expect(res.status).toBe(201);
  return { agent, csrf: res.body.data.csrfToken as string, res };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

describe('registration & login', () => {
  it('registers a business, owner session works, password is hashed', async () => {
    const { agent, res } = await signup(ctx.app, A);
    expect(res.body.data.tenant.slug).toBe('alpha');
    expect(JSON.stringify(res.body)).not.toContain('Str0ng');
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(A.email);
    expect(me.body.data.user.passwordHash).toBeUndefined();
    const row = ctx.db.$client.prepare('select password_hash h from users').get() as { h: string };
    expect(row.h).toMatch(/^\$2[aby]\$/);
  });
  it('rejects weak password / bad email / bad slug with 400', async () => {
    for (const bad of [{ ...A, password: 'short' }, { ...A, email: 'nope' }, { ...A, slug: 'Bad Slug!' }, { ...A, productSlug: 'unknown' }]) {
      const r = await request(ctx.app).post('/api/v1/auth/register-business').send(bad);
      expect(r.status).toBe(400);
    }
  });
  it('duplicate email or slug -> 409', async () => {
    await signup(ctx.app, A);
    expect((await request(ctx.app).post('/api/v1/auth/register-business').send({ ...B, email: A.email })).status).toBe(409);
    expect((await request(ctx.app).post('/api/v1/auth/register-business').send({ ...B, slug: A.slug })).status).toBe(409);
  });
  it('login ok / wrong password 401 with same message as unknown user', async () => {
    await signup(ctx.app, A);
    const ok = await request(ctx.app).post('/api/v1/auth/login').send({ email: A.email, password: A.password });
    expect(ok.status).toBe(200);
    const bad = await request(ctx.app).post('/api/v1/auth/login').send({ email: A.email, password: 'wrong-Pass1!' });
    const unk = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'x@y.co', password: 'wrong-Pass1!' });
    expect(bad.status).toBe(401); expect(unk.status).toBe(401);
    expect(bad.body.error.message).toBe(unk.body.error.message);
  });
  it('unauthenticated -> 401', async () => {
    expect((await request(ctx.app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(ctx.app).get('/api/v1/tenant/customers')).status).toBe(401);
  });
  it('logout invalidates the session', async () => {
    const { agent, csrf } = await signup(ctx.app, A);
    expect((await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf)).status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });
  it('expired session is rejected', async () => {
    const { agent } = await signup(ctx.app, A);
    ctx.db.$client.prepare("update sessions set expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('CSRF', () => {
  it('mutation without csrf header -> 403', async () => {
    const { agent } = await signup(ctx.app, A);
    expect((await agent.post('/api/v1/tenant/customers').send({ name: 'X', ref: 'C1' })).status).toBe(403);
  });
});

describe('tenant isolation over HTTP', () => {
  it('tenant B cannot see, read, update or delete tenant A customers', async () => {
    const a = await signup(ctx.app, A);
    const b = await signup(ctx.app, B);
    const created = await a.agent.post('/api/v1/tenant/customers').set('x-csrf-token', a.csrf).send({ name: 'Secret Patient', ref: 'C1' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const list = await b.agent.get('/api/v1/tenant/customers');
    expect(list.body.data).toEqual([]);
    expect((await b.agent.get(`/api/v1/tenant/customers/${id}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/v1/tenant/customers/${id}`).set('x-csrf-token', b.csrf).send({ name: 'Hacked' })).status).toBe(404);
    expect((await b.agent.delete(`/api/v1/tenant/customers/${id}`).set('x-csrf-token', b.csrf)).status).toBe(404);
    expect((await a.agent.get(`/api/v1/tenant/customers/${id}`)).body.data.name).toBe('Secret Patient');
  });
  it('client-supplied tenant id (header/body/query) is ignored', async () => {
    const a = await signup(ctx.app, A);
    const b = await signup(ctx.app, B);
    const tenantA = a.res.body.data.tenant.id as string;
    await a.agent.post('/api/v1/tenant/customers').set('x-csrf-token', a.csrf).send({ name: 'A-only', ref: 'C1' });
    const r = await b.agent.get(`/api/v1/tenant/customers?tenantId=${tenantA}`).set('x-tenant-id', tenantA);
    expect(r.body.data).toEqual([]);
    const c = await b.agent.post('/api/v1/tenant/customers').set('x-csrf-token', b.csrf).send({ name: 'B1', ref: 'C9', tenantId: tenantA });
    expect(c.body.data.tenantId).toBe(b.res.body.data.tenant.id);
  });
});

describe('permissions (backend RBAC)', () => {
  async function ownerWithEmployee(role: 'employee' | 'manager') {
    const o = await signup(ctx.app, A);
    const inv = await o.agent.post('/api/v1/tenant/employees').set('x-csrf-token', o.csrf)
      .send({ name: 'Emp', email: 'emp@alpha.test', password: 'Emp-Pass-1234!', role });
    expect(inv.status).toBe(201);
    const emp = request.agent(ctx.app);
    const login = await emp.post('/api/v1/auth/login').send({ email: 'emp@alpha.test', password: 'Emp-Pass-1234!' });
    return { o, emp, csrf: login.body.data.csrfToken as string };
  }
  it('employee can read but not delete customers, cannot manage employees', async () => {
    const { o, emp, csrf } = await ownerWithEmployee('employee');
    const c = await o.agent.post('/api/v1/tenant/customers').set('x-csrf-token', o.csrf).send({ name: 'X', ref: 'C1' });
    expect((await emp.get('/api/v1/tenant/customers')).status).toBe(200);
    expect((await emp.delete(`/api/v1/tenant/customers/${c.body.data.id}`).set('x-csrf-token', csrf)).status).toBe(403);
    expect((await emp.post('/api/v1/tenant/employees').set('x-csrf-token', csrf)
      .send({ name: 'E2', email: 'e2@alpha.test', password: 'Emp-Pass-1234!', role: 'employee' })).status).toBe(403);
  });
  it('employee of tenant A has no access to tenant B', async () => {
    const { emp } = await ownerWithEmployee('employee');
    const b = await signup(ctx.app, B);
    await b.agent.post('/api/v1/tenant/customers').set('x-csrf-token', b.csrf).send({ name: 'B-secret', ref: 'C1' });
    expect((await emp.get('/api/v1/tenant/customers')).body.data).toEqual([]);
  });
  it('owner role cannot be assigned through the employee endpoint', async () => {
    const o = await signup(ctx.app, A);
    const r = await o.agent.post('/api/v1/tenant/employees').set('x-csrf-token', o.csrf)
      .send({ name: 'E', email: 'e@alpha.test', password: 'Emp-Pass-1234!', role: 'owner' });
    expect(r.status).toBe(400);
  });
  it('suspended membership loses access immediately', async () => {
    const { emp } = await ownerWithEmployee('employee');
    ctx.db.$client.prepare("update memberships set status='suspended' where role_id in (select id from roles where name='employee')").run();
    expect((await emp.get('/api/v1/tenant/customers')).status).toBe(401);
  });
});

describe('errors & security headers', () => {
  it('malformed JSON -> 400 json error, no stack', async () => {
    const r = await request(ctx.app).post('/api/v1/auth/login').set('content-type', 'application/json').send('{bad');
    expect(r.status).toBe(400); expect(JSON.stringify(r.body)).not.toContain('at ');
  });
  it('unknown route -> 404 json', async () => {
    const r = await request(ctx.app).get('/api/v1/nope'); expect(r.status).toBe(404); expect(r.body.error.code).toBe('NOT_FOUND');
  });
  it('helmet headers present, x-powered-by absent', async () => {
    const r = await request(ctx.app).get('/api/v1/health');
    expect(r.status).toBe(200); expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['x-powered-by']).toBeUndefined();
  });
});
