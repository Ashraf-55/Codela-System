import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';

let db: ReturnType<typeof createDb>; let dns: Record<string, string[]>; let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = createDb(':memory:'); seedPlatform(db); dns = {};
  app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, rootDomain: 'codela.test', resolveTxt: async (h) => dns[h] ?? [] });
});
async function signup(slug: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register-business').send({ businessName: `Biz ${slug}`, slug, productSlug: 'medical', name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });
  const csrf = r.body.data.csrfToken as string;
  const h = (m: 'post' | 'put' | 'delete' | 'patch', u: string, b?: object) => agent[m](u).set('x-csrf-token', csrf).send(b ?? {});
  return { agent, csrf, tenantId: r.body.data.tenant.id as string, post: (u: string, b?: object) => h('post', u, b), put: (u: string, b?: object) => h('put', u, b), del: (u: string) => h('delete', u), patch: (u: string, b?: object) => h('patch', u, b) };
}
const site = { templateKey: 'classic', brand: { name: 'Alpha Clinic', primaryColor: '#0e7490', secondaryColor: '#15803d', logoUrl: 'https://cdn.example.com/logo.png', description: 'We care', socials: { facebook: 'https://facebook.com/alpha' } },
  sections: [{ type: 'hero', enabled: true, content: { title: 'Welcome' } }, { type: 'contact', enabled: true, content: {} }] };

describe('white-label site', () => {
  it('has a default draft; PUT validates', async () => {
    const t = await signup('alpha');
    const g = await t.agent.get('/api/v1/tenant/site');
    expect(g.status).toBe(200); expect(g.body.data.draft.brand.name).toBe('Biz alpha'); expect(g.body.data.publishedAt).toBeNull();
    expect((await t.put('/api/v1/tenant/site', site)).status).toBe(200);
    for (const bad of [
      { ...site, brand: { ...site.brand, primaryColor: 'red' } },
      { ...site, brand: { ...site.brand, logoUrl: 'javascript:alert(1)' } },
      { ...site, brand: { ...site.brand, socials: { x: 'data:text/html,<script>' } } },
      { ...site, templateKey: 'does-not-exist' },
      { ...site, sections: [{ type: 'script', enabled: true, content: {} }] },
    ]) expect((await t.put('/api/v1/tenant/site', bad)).status).toBe(400);
  });
  it('premium template needs the add-on', async () => {
    const t = await signup('alpha');
    const r = await t.put('/api/v1/tenant/site', { ...site, templateKey: 'premium-clinic' });
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    await t.post('/api/v1/tenant/addons/premium_templates/activate');
    expect((await t.put('/api/v1/tenant/site', { ...site, templateKey: 'premium-clinic' })).status).toBe(200);
  });
  it('public site: unpublished 404, published visible, later drafts hidden until republish, per-tenant', async () => {
    const a = await signup('alpha'); const b = await signup('beta');
    const pub = (host: string) => request(app).get('/api/v1/public/site').set('Host', host);
    expect((await pub('alpha.codela.test')).status).toBe(404);
    await a.put('/api/v1/tenant/site', site);
    expect((await a.post('/api/v1/tenant/site/publish')).status).toBe(200);
    const r = await pub('alpha.codela.test');
    expect(r.status).toBe(200); expect(r.body.data.brand.name).toBe('Alpha Clinic');
    await a.put('/api/v1/tenant/site', { ...site, brand: { ...site.brand, name: 'Changed Draft' } });
    expect((await pub('alpha.codela.test')).body.data.brand.name).toBe('Alpha Clinic');
    expect((await pub('beta.codela.test')).status).toBe(404);
    await b.put('/api/v1/tenant/site', { ...site, brand: { ...site.brand, name: 'Beta Brand' } }); await b.post('/api/v1/tenant/site/publish');
    expect((await pub('beta.codela.test')).body.data.brand.name).toBe('Beta Brand');
    expect((await pub('alpha.codela.test')).body.data.brand.name).toBe('Alpha Clinic');
    expect(JSON.stringify((await pub('alpha.codela.test')).body)).not.toContain('tenantId');
  });
  it('unknown host 404; employee without tenant.settings cannot edit', async () => {
    const a = await signup('alpha');
    expect((await request(app).get('/api/v1/public/site').set('Host', 'nobody.codela.test')).status).toBe(404);
    await a.post('/api/v1/tenant/employees', { name: 'Emp', email: 'e@a.test', password: 'Emp-Pass-1234!', role: 'employee' });
    const e = request.agent(app); const l = await e.post('/api/v1/auth/login').send({ email: 'e@a.test', password: 'Emp-Pass-1234!' });
    expect((await e.put('/api/v1/tenant/site').set('x-csrf-token', l.body.data.csrfToken).send(site)).status).toBe(403);
  });
});

describe('custom domains', () => {
  async function withDomainEntitlement(slug: string) { const t = await signup(slug); await t.post('/api/v1/tenant/addons/custom_domain/activate'); return t; }
  it('requires the customDomain entitlement', async () => {
    const t = await signup('alpha');
    const r = await t.post('/api/v1/tenant/domains', { hostname: 'shop.example.com' });
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
  it('rejects invalid hostnames', async () => {
    const t = await withDomainEntitlement('alpha');
    for (const h of ['http://shop.example.com', 'shop.example.com/path', '127.0.0.1', 'localhost', 'a_b.example.com', 'x.codela.test', 'nodot', ''])
      expect((await t.post('/api/v1/tenant/domains', { hostname: h })).status).toBe(400);
  });
  it('add -> pending with DNS instructions; wrong TXT stays pending; correct TXT verifies', async () => {
    const t = await withDomainEntitlement('alpha');
    const a = await t.post('/api/v1/tenant/domains', { hostname: 'Shop.Example.com' });
    expect(a.status).toBe(201); expect(a.body.data.status).toBe('pending'); expect(a.body.data.hostname).toBe('shop.example.com');
    expect(a.body.data.dns.txtName).toBe('_codela-verify.shop.example.com');
    const id = a.body.data.id as string; const token = a.body.data.dns.txtValue as string;
    dns['_codela-verify.shop.example.com'] = ['wrong-token'];
    const v1 = await t.post(`/api/v1/tenant/domains/${id}/verify`);
    expect(v1.status).toBe(200); expect(v1.body.data.verified).toBe(false); expect(v1.body.data.status).toBe('pending');
    dns['_codela-verify.shop.example.com'] = ['other', token];
    const v2 = await t.post(`/api/v1/tenant/domains/${id}/verify`);
    expect(v2.body.data.verified).toBe(true); expect(v2.body.data.status).toBe('verified');
  });
  it('same hostname cannot be claimed by two tenants', async () => {
    const a = await withDomainEntitlement('alpha'); const b = await withDomainEntitlement('beta');
    expect((await a.post('/api/v1/tenant/domains', { hostname: 'shop.example.com' })).status).toBe(201);
    expect((await b.post('/api/v1/tenant/domains', { hostname: 'shop.example.com' })).status).toBe(409);
  });
  it('routes by custom host only after verification and publish; primary only for verified; remove', async () => {
    const t = await withDomainEntitlement('alpha'); await t.put('/api/v1/tenant/site', site); await t.post('/api/v1/tenant/site/publish');
    const d = (await t.post('/api/v1/tenant/domains', { hostname: 'shop.example.com' })).body.data;
    const pub = () => request(app).get('/api/v1/public/site').set('Host', 'shop.example.com');
    expect((await pub()).status).toBe(404); // not verified => never routed
    expect((await t.post(`/api/v1/tenant/domains/${d.id}/primary`)).status).toBe(409);
    dns['_codela-verify.shop.example.com'] = [d.dns.txtValue];
    await t.post(`/api/v1/tenant/domains/${d.id}/verify`);
    expect((await pub()).status).toBe(200);
    expect((await t.post(`/api/v1/tenant/domains/${d.id}/primary`)).status).toBe(200);
    expect((await t.agent.get('/api/v1/tenant/domains')).body.data[0].isPrimary).toBe(true);
    expect((await t.del(`/api/v1/tenant/domains/${d.id}`)).status).toBe(200);
    expect((await pub()).status).toBe(404);
  });
  it("another tenant cannot verify/remove/list my domain", async () => {
    const a = await withDomainEntitlement('alpha'); const b = await withDomainEntitlement('beta');
    const d = (await a.post('/api/v1/tenant/domains', { hostname: 'shop.example.com' })).body.data;
    expect((await b.post(`/api/v1/tenant/domains/${d.id}/verify`)).status).toBe(404);
    expect((await b.del(`/api/v1/tenant/domains/${d.id}`)).status).toBe(404);
    expect((await b.agent.get('/api/v1/tenant/domains')).body.data).toEqual([]);
  });
});

describe('audit log API', () => {
  it('owner can read own tenant logs only; employee cannot', async () => {
    const a = await signup('alpha'); const b = await signup('beta');
    await a.post('/api/v1/tenant/customers', { name: 'X', ref: 'C1' });
    const l = await a.agent.get('/api/v1/tenant/audit-logs');
    expect(l.status).toBe(200);
    const actions = l.body.data.map((x: { action: string }) => x.action);
    expect(actions).toContain('tenant.registered'); expect(actions).toContain('customer.created');
    expect(l.body.data.every((x: { tenantId: string }) => x.tenantId === a.tenantId)).toBe(true);
    expect((await b.agent.get('/api/v1/tenant/audit-logs')).body.data.some((x: { action: string }) => x.action === 'customer.created')).toBe(false);
    await a.post('/api/v1/tenant/employees', { name: 'Emp', email: 'e@a.test', password: 'Emp-Pass-1234!', role: 'employee' });
    const e = request.agent(app); await e.post('/api/v1/auth/login').send({ email: 'e@a.test', password: 'Emp-Pass-1234!' });
    expect((await e.get('/api/v1/tenant/audit-logs')).status).toBe(403);
  });
});
