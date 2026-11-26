import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient } from './_helpers';

const PW = 'Str0ng-Pass!1';
const host = (slug: string) => `${slug}.codela.test`;
function portal(app: ReturnType<typeof createApp>, slug: string) {
  const agent = request.agent(app); let csrf = '';
  const call = (m: 'get' | 'post', u: string, b?: object) => { const r = agent[m](`/api/v1/public/portal${u}`).set('Host', host(slug)); if (m !== 'get') r.set('x-csrf-token', csrf); return b ? r.send(b) : r; };
  return { call, setCsrf: (c: string) => { csrf = c; } };
}
async function signIn(app: ReturnType<typeof createApp>, slug: string, name: string, email: string) {
  const p = portal(app, slug); const r = await p.call('post', '/register', { name, email, password: PW }); expect(r.status).toBe(201); p.setCsrf(r.body.data.csrfToken); return p;
}

describe('e-commerce portal: customer return requests', () => {
  it('only for own delivered orders, one open request at a time, quantities checked, refunds stay with the merchant', async () => {
    const db = createDb(':memory:'); seedPlatform(db);
    const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', portalEmailVerification: false });
    const o = await tenantClient(app, 'rtn', 'ecommerce');
    const prod = (await o.create('product', { name: 'Shirt', basePrice: 20000, status: 'active' })).body.data;
    const v = (await o.create('variant', { productId: prod.id, sku: 'SH-1' })).body.data;
    expect((await o.create('stockMovement', { variantId: v.id, type: 'in', qty: 10 })).status).toBe(201);
    const me = (await o.create('customer', { name: 'Sara Buyer', email: 'sara@x.com', phone: '01011112222' })).body.data;
    const other = (await o.create('customer', { name: 'Other Buyer', email: 'other@x.com', phone: '01033334444' })).body.data;
    const mk = async (customerId: string) => (await o.create('order', { customerId, lines: [{ variantId: v.id, qty: 2 }] })).body.data;
    const delivered = await mk(me.id); const pending = await mk(me.id); const theirs = await mk(other.id);
    for (const id of [delivered.id, theirs.id]) for (const s of ['confirmed', 'processing', 'shipped', 'delivered']) expect((await o.patch('order', id, { status: s })).status).toBe(200);

    const p = await signIn(app, 'rtn', 'Sara Buyer', 'sara@x.com');
    const ask = (orderId: string, qty = 1, reason = 'Too small') => p.call('post', '/returns', { orderId, reason, lines: [{ variantId: v.id, qty }] });
    expect((await ask(pending.id)).status).toBe(409);                    // not delivered yet
    expect((await ask(theirs.id)).status).toBe(404);                     // another customer's order looks like a missing one
    expect((await ask(delivered.id, 3)).status).toBe(409);               // more than ordered
    const ok = await ask(delivered.id, 1); expect(ok.status).toBe(201); expect(ok.body.data.status).toBe('requested');
    expect((await ask(delivered.id, 1)).status).toBe(409);               // one open request per order
    const list = (await p.call('get', '/returns')).body.data; expect(list).toHaveLength(1); expect(list[0].orderCode).toBe(delivered.code);
    expect(JSON.stringify(list)).not.toMatch(/refund/i);

    const staff = (await o.list('returnRequest')).body.data; expect(staff).toHaveLength(1);        // the merchant sees it in the dashboard
    expect((await o.get('order', delivered.id)).body.data.data.status).toBe('delivered');          // nothing moved by itself
    const stranger = await signIn(app, 'rtn', 'No Record', 'norecord@x.com');
    expect((await stranger.call('post', '/returns', { orderId: delivered.id, reason: 'x y z', lines: [{ variantId: v.id, qty: 1 }] })).status).toBe(404);
  });
});
