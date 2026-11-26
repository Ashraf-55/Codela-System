import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test' }); });

async function agency(slug = 'alpha') {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register-business').send({ businessName: `Agency ${slug}`, slug, productSlug: 'realestate', name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });
  expect(r.status).toBe(201);
  const csrf = r.body.data.csrfToken as string; const base = '/api/v1/tenant/p';
  const w = (m: 'post' | 'patch' | 'delete', u: string, b?: object) => agent[m](u).set('x-csrf-token', csrf).send(b ?? {});
  return { agent, csrf, list: (e: string, qs = '') => agent.get(`${base}/${e}${qs}`), get: (e: string, id: string) => agent.get(`${base}/${e}/${id}`),
    create: (e: string, b: object) => w('post', `${base}/${e}`, b), patch: (e: string, id: string, b: object) => w('patch', `${base}/${e}/${id}`, b), del: (e: string, id: string) => w('delete', `${base}/${e}/${id}`),
    post: (u: string, b?: object) => w('post', u, b) };
}
type A = Awaited<ReturnType<typeof agency>>;
async function seed(a: A) {
  const type = (await a.create('propertyType', { name: 'Apartment' })).body.data;
  const loc = (await a.create('location', { name: 'New Cairo', city: 'Cairo' })).body.data;
  const broker = (await a.create('broker', { name: 'Karim Broker', phone: '01001234567', email: 'k@alpha.test', commissionBp: 250 })).body.data;
  const client = (await a.create('client', { name: 'Hossam Buyer', phone: '01112223334', type: 'buyer' })).body.data;
  const prop = (await a.create('property', { title: '3BR Apartment', purpose: 'sale', typeId: type.id, locationId: loc.id, brokerId: broker.id, price: 250000000, area: 180, bedrooms: 3, bathrooms: 2 })).body.data;
  return { type, loc, broker, client, prop };
}
const D = (s: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ propertyId: s.prop.id, clientId: s.client.id, brokerId: s.broker.id, price: 240000000, ...over });

describe('properties', () => {
  it('meta lists realestate entities; CRUD with code, filters, search', async () => {
    const a = await agency(); const s = await seed(a);
    expect((await a.agent.get('/api/v1/tenant/p-meta')).body.data.entities.map((e: { key: string }) => e.key)).toEqual(expect.arrayContaining(['property', 'project', 'unit', 'saleDeal', 'rentalContract', 'commission', 'broker', 'lead']));
    expect(s.prop.code).toBe('PR-0001'); expect(s.prop.data.status).toBe('available');
    await a.create('property', { title: 'Villa Rent', purpose: 'rent', typeId: s.type.id, locationId: s.loc.id, price: 5000000, bedrooms: 5 });
    expect((await a.list('property', '?purpose=rent')).body.meta.total).toBe(1);
    expect((await a.list('property', '?bedrooms_from=4')).body.data[0].data.title).toBe('Villa Rent');
    expect((await a.list('property', '?price_from=100000000&price_to=300000000')).body.meta.total).toBe(1);
    expect((await a.list('property', '?q=villa')).body.meta.total).toBe(1);
    expect((await a.create('property', { title: 'x', purpose: 'sale', typeId: s.type.id, locationId: s.loc.id, price: 99.5 })).status).toBe(400);
    expect((await a.create('property', { title: 'Img', purpose: 'sale', typeId: s.type.id, locationId: s.loc.id, price: 1, images: [{ url: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await a.create('property', { title: 'Img', purpose: 'sale', typeId: s.type.id, locationId: s.loc.id, price: 1, images: [{ url: 'https://cdn.x.com/a.jpg', caption: 'front' }] })).status).toBe(201);
  });
  it('cross-tenant references are rejected', async () => {
    const a = await agency('alpha'); const b = await agency('beta'); const sa = await seed(a);
    const r = await b.create('property', { title: 'Steal', purpose: 'sale', typeId: sa.type.id, locationId: sa.loc.id, price: 1 });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('REFERENCE_NOT_FOUND');
  });
  it('projects and units: units belong to a project and track availability', async () => {
    const a = await agency(); const s = await seed(a);
    const proj = (await a.create('project', { name: 'Palm Towers', locationId: s.loc.id, developer: 'Dev Co', status: 'under_construction', deliveryDate: '2028-06-01' })).body.data;
    const u = await a.create('unit', { projectId: proj.id, unitNumber: 'A-101', floor: 1, area: 120, bedrooms: 2, price: 150000000 });
    expect(u.status).toBe(201); expect(u.body.data.data.status).toBe('available'); expect(u.body.data.code).toBe('UN-0001');
    expect((await a.list('unit', `?projectId=${proj.id}`)).body.meta.total).toBe(1);
    expect((await a.del('project', proj.id)).body.error.code).toBe('IN_USE');
  });
});

describe('sales workflow & commissions', () => {
  it('reserving a property blocks a second deal; completing marks sold and creates an exact commission', async () => {
    const a = await agency(); const s = await seed(a);
    const deal = (await a.create('saleDeal', D(s))).body.data;
    expect(deal.data.status).toBe('reserved');
    expect((await a.get('property', s.prop.id)).body.data.data.status).toBe('reserved');
    const second = await a.create('saleDeal', D(s, { price: 1000 })); expect(second.status).toBe(409); expect(second.body.error.code).toBe('NOT_AVAILABLE');
    expect((await a.patch('saleDeal', deal.id, { status: 'contracted' })).status).toBe(200);
    const done = await a.patch('saleDeal', deal.id, { status: 'completed' }); expect(done.status).toBe(200);
    expect((await a.get('property', s.prop.id)).body.data.data.status).toBe('sold');
    const c = (await a.list('commission')).body.data; expect(c).toHaveLength(1);
    expect(c[0].data.amount).toBe(6000000); // 240,000,000 * 2.5% (250 bp)
    expect(c[0].data.status).toBe('pending'); expect(c[0].data.brokerId).toBe(s.broker.id); expect(c[0].data.dealId).toBe(deal.id);
    expect((await a.patch('saleDeal', deal.id, { price: 1 })).body.error.code).toBe('IMMUTABLE');
  });
  it('cancelling a deal releases the property; invalid transitions rejected', async () => {
    const a = await agency(); const s = await seed(a); const deal = (await a.create('saleDeal', D(s))).body.data;
    expect((await a.patch('saleDeal', deal.id, { status: 'cancelled' })).status).toBe(200);
    expect((await a.get('property', s.prop.id)).body.data.data.status).toBe('available');
    expect((await a.list('commission')).body.data).toEqual([]);
    expect((await a.create('saleDeal', D(s))).status).toBe(201);
    const d2 = (await a.list('saleDeal', '?status=reserved')).body.data[0];
    expect((await a.patch('saleDeal', d2.id, { status: 'completed' })).body.error.code).toBe('INVALID_TRANSITION'); // must be contracted first
  });
  it('a deal targets exactly one of property/unit; rent properties cannot be sold', async () => {
    const a = await agency(); const s = await seed(a);
    expect((await a.create('saleDeal', D(s, { unitId: 'x' }))).status).toBe(400);
    expect((await a.create('saleDeal', { clientId: s.client.id, brokerId: s.broker.id, price: 1 })).status).toBe(400);
    const rent = (await a.create('property', { title: 'R', purpose: 'rent', typeId: s.type.id, locationId: s.loc.id, price: 1000 })).body.data;
    expect((await a.create('saleDeal', D(s, { propertyId: rent.id }))).body.error.code).toBe('NOT_AVAILABLE');
  });
  it('units can be sold too', async () => {
    const a = await agency(); const s = await seed(a);
    const proj = (await a.create('project', { name: 'P', locationId: s.loc.id })).body.data;
    const u = (await a.create('unit', { projectId: proj.id, unitNumber: 'B-1', price: 100000000 })).body.data;
    const d = (await a.create('saleDeal', { unitId: u.id, clientId: s.client.id, brokerId: s.broker.id, price: 100000000 })).body.data;
    expect((await a.get('unit', u.id)).body.data.data.status).toBe('reserved');
    await a.patch('saleDeal', d.id, { status: 'contracted' }); await a.patch('saleDeal', d.id, { status: 'completed' });
    expect((await a.get('unit', u.id)).body.data.data.status).toBe('sold');
  });
  it('commissions are system-created; only payment status can change', async () => {
    const a = await agency(); const s = await seed(a); const d = (await a.create('saleDeal', D(s))).body.data;
    await a.patch('saleDeal', d.id, { status: 'contracted' }); await a.patch('saleDeal', d.id, { status: 'completed' });
    expect((await a.create('commission', { dealId: d.id, brokerId: s.broker.id, amount: 1 })).status).toBe(405);
    const c = (await a.list('commission')).body.data[0];
    expect((await a.patch('commission', c.id, { amount: 1 })).status).toBe(400); // amount is readonly -> no fields to change
    const paid = await a.patch('commission', c.id, { status: 'paid' }); expect(paid.status).toBe(200); expect(paid.body.data.data.paidAt).toBeTruthy();
    expect((await a.patch('commission', c.id, { status: 'pending' })).body.error.code).toBe('IMMUTABLE');
    expect((await a.del('commission', c.id)).status).toBe(405);
  });
});

describe('rentals', () => {
  async function rentProp(a: A, s: Awaited<ReturnType<typeof seed>>) {
    return (await a.create('property', { title: 'Studio', purpose: 'rent', typeId: s.type.id, locationId: s.loc.id, price: 800000, brokerId: s.broker.id })).body.data;
  }
  it('contract occupies the property; ending releases; dates validated; no double rental', async () => {
    const a = await agency(); const s = await seed(a); const rp = await rentProp(a, s);
    const body = { propertyId: rp.id, clientId: s.client.id, brokerId: s.broker.id, monthlyRent: 800000, deposit: 1600000, startDate: '2030-01-01', endDate: '2030-12-31' };
    expect((await a.create('rentalContract', { ...body, endDate: '2029-12-31' })).status).toBe(400);
    const c = (await a.create('rentalContract', body)).body.data; expect(c.code).toBe('RC-0001'); expect(c.data.status).toBe('active');
    expect((await a.get('property', rp.id)).body.data.data.status).toBe('rented');
    expect((await a.create('rentalContract', body)).body.error.code).toBe('NOT_AVAILABLE');
    expect((await a.patch('rentalContract', c.id, { status: 'ended' })).status).toBe(200);
    expect((await a.get('property', rp.id)).body.data.data.status).toBe('available');
    expect((await a.patch('rentalContract', c.id, { status: 'active' })).body.error.code).toBe('IMMUTABLE');
    expect((await a.create('rentalContract', { ...body, propertyId: s.prop.id })).body.error.code).toBe('NOT_AVAILABLE'); // sale property
  });
});

describe('leads', () => {
  it('pipeline stages; terminal stages are final', async () => {
    const a = await agency(); const s = await seed(a);
    const l = (await a.create('lead', { name: 'Prospect', phone: '01099998888', source: 'website', propertyId: s.prop.id, budget: 200000000 })).body.data;
    expect(l.data.stage).toBe('new'); expect(l.code).toBe('LD-0001');
    expect((await a.patch('lead', l.id, { stage: 'viewing' })).status).toBe(200);
    expect((await a.patch('lead', l.id, { stage: 'won' })).status).toBe(200);
    expect((await a.patch('lead', l.id, { stage: 'new' })).body.error.code).toBe('IMMUTABLE');
    expect((await a.list('lead', '?stage=won')).body.meta.total).toBe(1);
  });
});

describe('dashboard, reports, permissions', () => {
  it('KPIs and broker performance come from real records', async () => {
    const a = await agency(); const s = await seed(a);
    const d = (await a.create('saleDeal', D(s))).body.data; await a.patch('saleDeal', d.id, { status: 'contracted' }); await a.patch('saleDeal', d.id, { status: 'completed' });
    await a.create('property', { title: 'Another', purpose: 'sale', typeId: s.type.id, locationId: s.loc.id, price: 5 });
    const k = (await a.agent.get('/api/v1/tenant/dashboard')).body.data.kpis;
    expect(k.propertiesAvailable).toBe(1); expect(k.salesValueMonth).toBe(240000000); expect(k.commissionsPending).toBe(6000000);
    const byBroker = (await a.agent.get('/api/v1/tenant/reports/salesByBroker')).body.data;
    expect(byBroker).toEqual([{ key: s.broker.id, value: 240000000 }]);
    expect((await a.agent.get('/api/v1/tenant/reports/propertiesByStatus')).body.data.find((x: { key: string }) => x.key === 'sold').value).toBe(1);
  });
  it('employees cannot see commissions or delete; manager can', async () => {
    const a = await agency(); await seed(a);
    await a.post('/api/v1/tenant/employees', { name: 'Emp', email: 'e@alpha.test', password: 'Emp-Pass-1234!', role: 'employee' });
    const e = request.agent(app); const l = await e.post('/api/v1/auth/login').send({ email: 'e@alpha.test', password: 'Emp-Pass-1234!' });
    expect((await e.get('/api/v1/tenant/p/property')).status).toBe(200);
    expect((await e.get('/api/v1/tenant/p/commission')).status).toBe(403);
    expect((await e.delete('/api/v1/tenant/p/property/x').set('x-csrf-token', l.body.data.csrfToken)).status).toBe(403);
    const k = (await e.get('/api/v1/tenant/dashboard')).body.data.kpis; expect(k.commissionsPending).toBeUndefined();
  });
  it('global search covers properties, clients, brokers, leads, deals', async () => {
    const a = await agency(); const s = await seed(a); await a.create('lead', { name: 'Zed Lead', phone: '01055556666', source: 'call' });
    const t = async (q: string) => (await a.agent.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).body.data.map((x: { entityType: string }) => x.entityType);
    expect(await t('apartment')).toContain('property'); expect(await t('hossam')).toContain('client'); expect(await t('karim')).toContain('broker'); expect(await t('zed')).toContain('lead'); expect(await t(s.prop.code)).toContain('property');
  });
});

describe('public website', () => {
  const host = 'alpha.codela.test';
  it('advanced property search shows only available listings with public fields', async () => {
    const a = await agency(); const s = await seed(a);
    await a.create('property', { title: 'Cheap Studio', purpose: 'sale', typeId: s.type.id, locationId: s.loc.id, price: 90000000, bedrooms: 1, area: 60 });
    await a.create('property', { title: 'Hidden Draft', purpose: 'sale', typeId: s.type.id, locationId: s.loc.id, price: 1, status: 'inactive' });
    const get = (qs = '') => request(app).get(`/api/v1/public/catalog/property${qs}`).set('Host', host);
    expect((await get()).body.meta.total).toBe(2);
    expect((await get(`?locationId=${s.loc.id}&bedrooms_from=2`)).body.data.map((p: { title: string }) => p.title)).toEqual(['3BR Apartment']);
    expect((await get('?price_to=100000000')).body.data.map((p: { title: string }) => p.title)).toEqual(['Cheap Studio']);
    expect((await get(`?typeId=${s.type.id}&sort=price&dir=desc`)).body.data[0].title).toBe('3BR Apartment');
    expect((await get('?status=inactive')).body.meta.total).toBe(2); // forced availability filter cannot be overridden
    expect(JSON.stringify((await get()).body)).not.toMatch(/tenantId|brokerId/);
    expect((await request(app).get('/api/v1/public/catalog/commission').set('Host', host)).status).toBe(404);
  });
  it('brokers and projects are public; sold properties disappear; inquiry links to a property of the same tenant', async () => {
    const a = await agency(); const b = await agency('beta'); const s = await seed(a);
    expect((await request(app).get('/api/v1/public/catalog/broker').set('Host', host)).body.data[0].name).toBe('Karim Broker');
    const d = (await a.create('saleDeal', D(s))).body.data; await a.patch('saleDeal', d.id, { status: 'contracted' }); await a.patch('saleDeal', d.id, { status: 'completed' });
    expect((await request(app).get('/api/v1/public/catalog/property').set('Host', host)).body.meta.total).toBe(0);
    const ok = await request(app).post('/api/v1/public/forms/propertyInquiry').set('Host', host).send({ name: 'Visitor', phone: '01011112222', propertyId: s.prop.id, message: 'Interested' });
    expect(ok.status).toBe(201); expect((await a.list('inquiry')).body.meta.total).toBe(1); expect((await b.list('inquiry')).body.meta.total).toBe(0);
    const evil = await request(app).post('/api/v1/public/forms/propertyInquiry').set('Host', 'beta.codela.test').send({ name: 'V', phone: '01011112222', propertyId: s.prop.id });
    expect(evil.status).toBe(400);
  });
});
