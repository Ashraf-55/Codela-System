import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

describe('tenant regional settings', () => {
  it('reads and updates currency, locale, timezone and default tax; validates input', async () => {
    const t = await tenantClient(ctx.app, 'alpha', 'ecommerce');
    expect((await t.agent.get('/api/v1/tenant/settings')).body.data).toMatchObject({ currency: 'EGP', locale: 'ar', timezone: 'Africa/Cairo', taxBp: 0, name: 'Biz alpha' });
    const ok = await t.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', t.csrf).send({ timezone: 'Asia/Riyadh', locale: 'en', taxBp: 1500, name: 'Alpha Store' }); expect(ok.status).toBe(200);
    expect((await t.agent.get('/api/v1/tenant/settings')).body.data).toMatchObject({ timezone: 'Asia/Riyadh', locale: 'en', taxBp: 1500, name: 'Alpha Store' });
    for (const bad of [{ timezone: 'Mars/Base' }, { taxBp: 10001 }, { taxBp: 1.5 }, { locale: 'fr' }, { currency: 'XXX' }, {}]) expect((await t.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', t.csrf).send(bad)).status, JSON.stringify(bad)).toBe(400);
  });
  it('currency is locked once financial data exists; allowed before', async () => {
    const t = await tenantClient(ctx.app, 'alpha', 'ecommerce');
    expect((await t.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', t.csrf).send({ currency: 'SAR' })).status).toBe(200); expect((await t.agent.get('/api/v1/tenant/settings')).body.data.currency).toBe('SAR');
    await t.create('category', { name: 'Shirts' });
    const r = await t.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', t.csrf).send({ currency: 'AED' }); expect(r.status).toBe(409); expect(r.body.error.code).toBe('CURRENCY_LOCKED');
  });
  it('requires tenant.settings and is isolated per tenant', async () => {
    const a = await tenantClient(ctx.app, 'alpha', 'ecommerce'); const b = await tenantClient(ctx.app, 'beta', 'ecommerce'); const e = await employeeAgent(ctx.app, a, 'alpha');
    expect((await e.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', e.csrf).send({ taxBp: 500 })).status).toBe(403);
    await a.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', a.csrf).send({ taxBp: 1400 }); expect((await b.agent.get('/api/v1/tenant/settings')).body.data.taxBp).toBe(0);
    expect((await request(ctx.app).get('/api/v1/tenant/settings')).status).toBe(401);
  });
  it('the default tax applies to public online orders (storefront checkout)', async () => {
    const t = await tenantClient(ctx.app, 'alpha', 'ecommerce');
    const cat = (await t.create('category', { name: 'C' })).body.data; const prod = (await t.create('product', { name: 'Shirt', categoryId: cat.id, basePrice: 10000, status: 'active' })).body.data;
    const v = (await t.create('variant', { productId: prod.id, sku: 'S-1' })).body.data; await t.create('stockMovement', { variantId: v.id, type: 'in', qty: 5 });
    const ship = (await t.create('shippingMethod', { name: 'Std', fee: 0 })).body.data; const pay = (await t.create('paymentMethod', { name: 'COD', type: 'cod' })).body.data;
    await t.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', t.csrf).send({ taxBp: 1400 });
    const body = { customer: { name: 'Web B', phone: '01001234567' }, address: { name: 'W', phone: '01001234567', address: 'x', city: 'y' }, lines: [{ variantId: v.id, qty: 1 }], shippingMethodId: ship.id, paymentMethodId: pay.id };
    const q = await request(ctx.app).post('/api/v1/public/actions/quote').set('Host', 'alpha.codela.test').send(body); expect(q.body.data).toMatchObject({ subtotal: 10000, tax: 1400, total: 11400 });
    const c = await request(ctx.app).post('/api/v1/public/actions/checkout').set('Host', 'alpha.codela.test').send(body); expect(c.status).toBe(201); expect(c.body.data.total).toBe(11400);
  });
});
