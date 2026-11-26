import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const shop = (slug = 'alpha') => tenantClient(ctx.app, slug, 'ecommerce');
const host = (slug = 'alpha') => `${slug}.codela.test`;

async function seed(s: TC, stock = 10) {
  const cat = (await s.create('category', { name: 'Shirts' })).body.data;
  const prod = (await s.create('product', { name: 'Cotton Shirt', categoryId: cat.id, basePrice: 20000, status: 'active', description: 'Nice' })).body.data;
  const variant = (await s.create('variant', { productId: prod.id, sku: 'SH-RED-M', attributes: [{ name: 'Color', value: 'Red' }, { name: 'Size', value: 'M' }], price: 25000 })).body.data;
  const v2 = (await s.create('variant', { productId: prod.id, sku: 'SH-BLU-L', attributes: [{ name: 'Color', value: 'Blue' }] })).body.data; // falls back to basePrice
  if (stock) { await s.create('stockMovement', { variantId: variant.id, type: 'in', qty: stock, reason: 'initial' }); await s.create('stockMovement', { variantId: v2.id, type: 'in', qty: stock, reason: 'initial' }); }
  const ship = (await s.create('shippingMethod', { name: 'Standard', fee: 5000, freeOver: 100000, etaDays: 3 })).body.data;
  const pay = (await s.create('paymentMethod', { name: 'Cash on delivery', type: 'cod' })).body.data;
  const cust = (await s.create('customer', { name: 'Sara Buyer', phone: '01001234567', email: 'sara@x.test' })).body.data;
  return { cat, prod, variant, v2, ship, pay, cust };
}
const order = (x: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ customerId: x.cust.id, shippingMethodId: x.ship.id, paymentMethodId: x.pay.id,
  lines: [{ variantId: x.variant.id, qty: 2 }], shipName: 'Sara', shipPhone: '01001234567', shipAddress: '1 Nile St', shipCity: 'Cairo', ...over });
const stockOf = async (s: TC, id: string) => (await s.get('variant', id)).body.data.data.stock as number;

describe('catalog & inventory', () => {
  it('variants: unique SKU, readonly stock, ledger-driven stock', async () => {
    const s = await shop(); const x = await seed(s);
    expect(x.variant.data.stock).toBe(0); expect((await s.create('variant', { productId: x.prod.id, sku: 'sh-red-m' })).status).toBe(409);
    expect((await s.patch('variant', x.variant.id, { stock: 999, price: 26000 })).body.data.data.stock).toBe(10);
    expect(await stockOf(s, x.variant.id)).toBe(10);
  });
  it('stock movements adjust stock; cannot go negative; ledger immutable', async () => {
    const s = await shop(); const x = await seed(s);
    const out = await s.create('stockMovement', { variantId: x.variant.id, type: 'out', qty: 4, reason: 'manual' }); expect(out.status).toBe(201);
    expect(await stockOf(s, x.variant.id)).toBe(6);
    const over = await s.create('stockMovement', { variantId: x.variant.id, type: 'out', qty: 7 }); expect(over.status).toBe(409); expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
    await s.create('stockMovement', { variantId: x.variant.id, type: 'adjust_up', qty: 3 }); await s.create('stockMovement', { variantId: x.variant.id, type: 'damaged', qty: 1 });
    expect(await stockOf(s, x.variant.id)).toBe(8);
    expect((await s.patch('stockMovement', out.body.data.id, { qty: 1 })).status).toBe(405); expect((await s.del('stockMovement', out.body.data.id)).status).toBe(405);
    expect((await s.del('product', x.prod.id)).body.error.code).toBe('IN_USE');
  });
});

describe('orders: pricing, stock, coupons', () => {
  it('computes totals with integer math, ignores client totals, decrements stock', async () => {
    const s = await shop(); const x = await seed(s);
    await s.create('coupon', { code: 'save10', type: 'percent', value: 10, minOrder: 0 });
    const r = await s.create('order', order(x, { couponCode: 'SAVE10', taxBp: 1400, total: 1, lines: [{ variantId: x.variant.id, qty: 2 }, { variantId: x.v2.id, qty: 1 }] }));
    expect(r.status).toBe(201);
    const d = r.body.data.data; // subtotal 2*25000 + 20000 = 70000; discount 10% = 7000; shipping 5000 (below free threshold); tax 14% of 63000 = 8820; total 63000+5000+8820
    expect(d.subtotal).toBe(70000); expect(d.discount).toBe(7000); expect(d.shippingFee).toBe(5000); expect(d.tax).toBe(8820); expect(d.total).toBe(76820);
    expect(d.status).toBe('pending'); expect(d.paymentStatus).toBe('unpaid'); expect(r.body.data.code).toBe('ORD-0001');
    expect(d.items[0]).toMatchObject({ sku: 'SH-RED-M', unitPrice: 25000, qty: 2, lineTotal: 50000 });
    expect(await stockOf(s, x.variant.id)).toBe(8); expect(await stockOf(s, x.v2.id)).toBe(9);
    expect((await s.list('coupon')).body.data[0].data.usedCount).toBe(1);
  });
  it('free shipping over the threshold; fixed coupon capped at subtotal', async () => {
    const s = await shop(); const x = await seed(s, 100);
    await s.create('coupon', { code: 'BIG', type: 'fixed', value: 999999 });
    const r = await s.create('order', order(x, { couponCode: 'big', lines: [{ variantId: x.variant.id, qty: 5 }] })); // 125000 >= freeOver
    expect(r.body.data.data.shippingFee).toBe(0); expect(r.body.data.data.discount).toBe(125000); expect(r.body.data.data.total).toBe(0);
  });
  it('is atomic: a failing line leaves stock and coupon untouched', async () => {
    const s = await shop(); const x = await seed(s, 3);
    await s.create('coupon', { code: 'C1', type: 'fixed', value: 100 });
    const r = await s.create('order', order(x, { couponCode: 'C1', lines: [{ variantId: x.variant.id, qty: 2 }, { variantId: x.v2.id, qty: 99 }] }));
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(s, x.variant.id)).toBe(3); expect((await s.list('coupon')).body.data[0].data.usedCount).toBe(0); expect((await s.list('order')).body.meta.total).toBe(0);
  });
  it('rejects inactive products, invalid/expired/overused coupons, cross-tenant variants', async () => {
    const s = await shop(); const x = await seed(s); const o = await shop('beta'); const xo = await seed(o);
    await s.patch('product', x.prod.id, { status: 'archived' });
    expect((await s.create('order', order(x))).body.error.code).toBe('NOT_AVAILABLE');
    await s.patch('product', x.prod.id, { status: 'active' });
    await s.create('coupon', { code: 'OLD', type: 'fixed', value: 100, endsAt: '2020-01-01' }); await s.create('coupon', { code: 'MIN', type: 'fixed', value: 100, minOrder: 10000000 });
    await s.create('coupon', { code: 'ONE', type: 'fixed', value: 100, maxUses: 1 });
    for (const c of ['OLD', 'MIN', 'NOPE']) expect((await s.create('order', order(x, { couponCode: c }))).body.error.code).toBe('COUPON_INVALID');
    expect((await s.create('order', order(x, { couponCode: 'ONE' }))).status).toBe(201);
    expect((await s.create('order', order(x, { couponCode: 'ONE' }))).body.error.code).toBe('COUPON_INVALID');
    expect((await s.create('order', order(x, { lines: [{ variantId: xo.variant.id, qty: 1 }] }))).body.error.code).toBe('REFERENCE_NOT_FOUND');
  });
});

describe('order lifecycle', () => {
  it('transitions, invoice on confirm, restock on cancel, refund required if paid, terminal immutable', async () => {
    const s = await shop(); const x = await seed(s);
    const o = (await s.create('order', order(x))).body.data;
    expect((await s.patch('order', o.id, { status: 'shipped' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await s.patch('order', o.id, { status: 'confirmed' })).status).toBe(200);
    const inv = (await s.list('invoice')).body.data; expect(inv).toHaveLength(1); expect(inv[0].data.total).toBe(o.data.total); expect(inv[0].data.orderId).toBe(o.id);
    expect((await s.patch('order', o.id, { total: 1 })).status).toBe(400);
    expect((await s.patch('order', o.id, { status: 'cancelled' })).status).toBe(200);
    expect(await stockOf(s, x.variant.id)).toBe(10);
    expect((await s.patch('order', o.id, { status: 'confirmed' })).body.error.code).toBe('IMMUTABLE');
    const o2 = (await s.create('order', order(x))).body.data;
    await s.patch('order', o2.id, { paymentStatus: 'paid' });
    expect((await s.patch('order', o2.id, { status: 'cancelled' })).body.error.code).toBe('REFUND_REQUIRED');
    expect((await s.patch('order', o2.id, { paymentStatus: 'refunded' })).status).toBe(409);
  });
});

describe('returns & refunds', () => {
  async function delivered(s: TC, x: Awaited<ReturnType<typeof seed>>) {
    const o = (await s.create('order', order(x))).body.data; await s.patch('order', o.id, { paymentStatus: 'paid' });
    for (const st of ['confirmed', 'processing', 'shipped', 'delivered']) expect((await s.patch('order', o.id, { status: st })).status).toBe(200);
    return o;
  }
  it('only delivered orders; full flow restocks and refunds exactly once', async () => {
    const s = await shop(); const x = await seed(s); const pending = (await s.create('order', order(x))).body.data;
    expect((await s.create('returnRequest', { orderId: pending.id, reason: 'x', lines: [{ variantId: x.variant.id, qty: 1 }] })).body.error.code).toBe('ORDER_NOT_DELIVERED');
    const o = await delivered(s, x); const stockBefore = await stockOf(s, x.variant.id);
    const rr = (await s.create('returnRequest', { orderId: o.id, reason: 'Too small', lines: [{ variantId: x.variant.id, qty: 2 }] })).body.data;
    expect((await s.create('returnRequest', { orderId: o.id, reason: 'x', lines: [{ variantId: x.variant.id, qty: 3 }] })).status).toBe(409); // more than ordered
    expect((await s.patch('returnRequest', rr.id, { status: 'received' })).body.error.code).toBe('INVALID_TRANSITION');
    await s.patch('returnRequest', rr.id, { status: 'approved' }); await s.patch('returnRequest', rr.id, { status: 'received' });
    expect(await stockOf(s, x.variant.id)).toBe(stockBefore + 2);
    expect((await s.patch('returnRequest', rr.id, { status: 'refunded' })).status).toBe(400); // refundAmount required
    expect((await s.patch('returnRequest', rr.id, { status: 'refunded', refundAmount: o.data.total + 1 })).body.error.code).toBe('OVER_REFUND');
    expect((await s.patch('returnRequest', rr.id, { status: 'refunded', refundAmount: o.data.total })).status).toBe(200);
    expect((await s.list('refund')).body.data[0].data.amount).toBe(o.data.total);
    const fin = (await s.get('order', o.id)).body.data.data; expect(fin.paymentStatus).toBe('refunded'); expect(fin.status).toBe('returned');
    expect((await s.create('refund', { orderId: o.id, amount: 1 })).status).toBe(405);
  });
});

describe('storefront (public)', () => {
  it('catalog shows only active products with filters; no private fields', async () => {
    const s = await shop(); const x = await seed(s);
    await s.create('product', { name: 'Draft Item', categoryId: x.cat.id, basePrice: 1, status: 'draft' });
    const get = (qs = '') => request(ctx.app).get(`/api/v1/public/catalog/product${qs}`).set('Host', host());
    expect((await get()).body.data.map((p: { name: string }) => p.name)).toEqual(['Cotton Shirt']);
    expect((await get(`?categoryId=${x.cat.id}&basePrice_to=30000`)).body.meta.total).toBe(1); expect((await get('?basePrice_from=30000')).body.meta.total).toBe(0);
    expect(JSON.stringify((await get()).body)).not.toMatch(/tenantId|supplierId/);
    expect((await request(ctx.app).get('/api/v1/public/catalog/variant').set('Host', host())).body.data.length).toBe(2);
    expect((await request(ctx.app).get('/api/v1/public/catalog/coupon').set('Host', host())).status).toBe(404);
    expect((await request(ctx.app).get('/api/v1/public/catalog/shippingMethod').set('Host', host())).body.data[0].name).toBe('Standard');
  });
  it('quote, checkout (creates customer+order), tracking requires matching phone, tenant isolation', async () => {
    const s = await shop(); const x = await seed(s); const o = await shop('beta'); const xo = await seed(o);
    const body = { customer: { name: 'Web Buyer', phone: '٠١٠٠٩٩٩٨٨٨٨', email: 'w@x.test' }, address: { name: 'Web Buyer', phone: '01009998888', address: '5 Tahrir', city: 'Cairo' },
      lines: [{ variantId: x.variant.id, qty: 1 }], shippingMethodId: x.ship.id, paymentMethodId: x.pay.id };
    const q = await request(ctx.app).post('/api/v1/public/actions/quote').set('Host', host()).send(body);
    expect(q.status).toBe(200); expect(q.body.data.subtotal).toBe(25000); expect(q.body.data.total).toBe(30000);
    expect(await stockOf(s, x.variant.id)).toBe(10); // quote does not reserve
    const c = await request(ctx.app).post('/api/v1/public/actions/checkout').set('Host', host()).send(body);
    expect(c.status).toBe(201); expect(c.body.data.orderCode).toBe('ORD-0001'); expect(c.body.data.total).toBe(30000);
    expect(await stockOf(s, x.variant.id)).toBe(9);
    await request(ctx.app).post('/api/v1/public/actions/checkout').set('Host', host()).send(body);
    expect((await s.list('customer', '?q=0100999')).body.meta.total).toBe(1); // same phone => same customer
    const t = await request(ctx.app).get('/api/v1/public/actions/track?code=ORD-0001&phone=01009998888').set('Host', host());
    expect(t.status).toBe(200); expect(t.body.data.status).toBe('pending'); expect(JSON.stringify(t.body)).not.toMatch(/tenantId|customerId/);
    expect((await request(ctx.app).get('/api/v1/public/actions/track?code=ORD-0001&phone=01000000000').set('Host', host())).status).toBe(404);
    expect((await request(ctx.app).get('/api/v1/public/actions/track?code=ORD-0001&phone=01009998888').set('Host', host('beta'))).status).toBe(404);
    const evil = await request(ctx.app).post('/api/v1/public/actions/checkout').set('Host', host('beta')).send(body);
    expect(evil.status).toBe(400);
    expect(await stockOf(o, xo.variant.id)).toBe(10);
  });
  it('checkout rejects insufficient stock atomically', async () => {
    const s = await shop(); const x = await seed(s, 1);
    const r = await request(ctx.app).post('/api/v1/public/actions/checkout').set('Host', host()).send({ customer: { name: 'B B', phone: '01001112222' }, address: { name: 'B', phone: '01001112222', address: 'x', city: 'y' },
      lines: [{ variantId: x.variant.id, qty: 5 }], shippingMethodId: x.ship.id, paymentMethodId: x.pay.id });
    expect(r.status).toBe(409); expect((await s.list('customer')).body.meta.total).toBe(1); // only the seeded customer; the failed checkout rolled back
  });
});

describe('permissions, KPIs, search', () => {
  it('employee: orders yes; coupons/refunds/suppliers no; KPIs and reports are real', async () => {
    const s = await shop(); const x = await seed(s); const e = await employeeAgent(ctx.app, s, 'alpha');
    expect((await e.agent.get('/api/v1/tenant/p/order')).status).toBe(200); expect((await e.agent.get('/api/v1/tenant/p/coupon')).status).toBe(403); expect((await e.agent.get('/api/v1/tenant/p/refund')).status).toBe(403);
    expect((await e.agent.post('/api/v1/tenant/p/order').set('x-csrf-token', e.csrf).send(order(x))).status).toBe(201);
    const o = (await s.list('order')).body.data[0]; await s.patch('order', o.id, { status: 'confirmed' });
    const k = await s.kpis(); expect(k.ordersToday).toBe(1); expect(k.salesMonth).toBe(o.data.total); expect(k.pendingOrders).toBe(0); expect(k.products).toBe(1);
    expect((await s.report('ordersByStatus')).find((r) => r.key === 'confirmed')!.value).toBe(1);
    expect((await e.agent.get('/api/v1/tenant/dashboard')).body.data.kpis.salesMonth).toBeDefined();
  });
  it('global search finds products, variants (SKU), customers, orders', async () => {
    const s = await shop(); const x = await seed(s); const o = (await s.create('order', order(x))).body.data;
    expect((await s.search('cotton')).map((r) => r.entityType)).toContain('product'); expect((await s.search('SH-RED')).map((r) => r.entityType)).toContain('variant');
    expect((await s.search('sara')).map((r) => r.entityType)).toContain('customer'); expect((await s.search(o.code)).map((r) => r.entityType)).toContain('order');
    expect((await s.search('0100123')).map((r) => r.entityType)).toContain('customer');
  });
});

describe('profit, low stock, compare-at price, policies', () => {
  it('gross profit = net sales - cost of goods from the cost snapshot; cancelled orders drop out; only finance-level roles see profit', async () => {
    const s = await shop(); const x = await seed(s);
    await s.patch('variant', x.variant.id, { cost: 12000 }); // price 25000 -> margin 13000 per unit
    const o = (await s.create('order', order(x, { lines: [{ variantId: x.variant.id, qty: 2 }] }))).body.data; expect(o.data).toMatchObject({ netSales: 50000, cogs: 24000 });
    let k = await s.kpis(); expect(k).toMatchObject({ cogsMonth: 24000, grossProfitMonth: 26000 });
    await s.patch('variant', x.variant.id, { cost: 99999 }); // later cost changes never rewrite history
    expect((await s.get('order', o.id)).body.data.data.cogs).toBe(24000);
    await s.patch('variant', x.variant.id, { cost: 12000 }); const o2 = (await s.create('order', order(x))).body.data; expect((await s.kpis()).grossProfitMonth).toBe(52000);
    await s.patch('order', o2.id, { status: 'cancelled' }); k = await s.kpis(); expect(k.grossProfitMonth).toBe(26000);
    const emp = await employeeAgent(ctx.app, s, 'alpha'); const ek = (await emp.agent.get('/api/v1/tenant/dashboard')).body.data.kpis; expect(ek.grossProfitMonth).toBeUndefined(); expect(ek.cogsMonth).toBeUndefined();
    const day = await s.report('salesByDay'); expect(day.reduce((a, r) => a + r.value, 0)).toBe(50000);
  });
  it('low stock is flagged from the reorder level (and follows every stock movement)', async () => {
    const s = await shop(); const x = await seed(s, 10); await s.patch('variant', x.variant.id, { reorderLevel: 8 });
    expect((await s.get('variant', x.variant.id)).body.data.data.lowStock).toBe(false); expect((await s.kpis()).lowStock).toBe(0);
    await s.create('stockMovement', { variantId: x.variant.id, type: 'out', qty: 3, reason: 'sold offline' });
    expect((await s.get('variant', x.variant.id)).body.data.data.lowStock).toBe(true); expect((await s.kpis()).lowStock).toBe(1);
    await s.create('stockMovement', { variantId: x.variant.id, type: 'in', qty: 20 }); expect((await s.get('variant', x.variant.id)).body.data.data.lowStock).toBe(false);
  });
  it('compare-at price and featured are public; only active policies are public', async () => {
    const s = await shop(); const x = await seed(s); await s.patch('product', x.prod.id, { compareAtPrice: 30000, featured: true });
    await s.create('policy', { title: 'Returns', kind: 'returns', body: '14 days.' }); await s.create('policy', { title: 'Hidden', body: 'x', active: false });
    const pub = (e: string, q = '') => request(ctx.app).get(`/api/v1/public/catalog/${e}${q}`).set('host', host());
    const p = (await pub('product', '?featured=true')).body.data[0]; expect(p).toMatchObject({ compareAtPrice: 30000, featured: true }); expect((await pub('product', '?featured=false')).body.data).toHaveLength(0);
    expect((await pub('policy')).body.data.map((q: { title: string }) => q.title)).toEqual(['Returns']);
    expect((await pub('variant')).body.data[0].cost).toBeUndefined(); // cost is never public
  });
});

describe('payment records and exchanges', () => {
  it('payments are recorded against the order; they add up to the total, then the order is paid; no overpay; cancelled orders take none', async () => {
    const s = await shop(); const x = await seed(s); const o = (await s.create('order', order(x))).body.data; const total = o.data.total as number;
    expect((await s.create('payment', { orderId: o.id, amount: 1000, method: 'transfer', reference: 'TX1' })).status).toBe(201); expect((await s.get('order', o.id)).body.data.data.paymentStatus).toBe('unpaid');
    expect((await s.create('payment', { orderId: o.id, amount: total, method: 'cod' })).body.error.code).toBe('OVERPAYMENT');
    expect((await s.create('payment', { orderId: o.id, amount: total - 1000, method: 'cod' })).status).toBe(201); expect((await s.get('order', o.id)).body.data.data.paymentStatus).toBe('paid');
    const o2 = (await s.create('order', order(x))).body.data; await s.patch('order', o2.id, { status: 'cancelled' }); expect((await s.create('payment', { orderId: o2.id, amount: 100, method: 'cash' })).body.error.code).toBe('NOT_PAYABLE');
  });
  it('an exchange restocks the returned goods and ends with a replacement order of the same customer, never with a refund', async () => {
    const s = await shop(); const x = await seed(s); const o = (await s.create('order', order(x))).body.data; const adv = async (id: string, st: string) => s.patch('order', id, { status: st });
    for (const st of ['confirmed', 'processing', 'shipped', 'delivered']) await adv(o.id, st);
    const before = await stockOf(s, x.variant.id); const r = (await s.create('returnRequest', { orderId: o.id, kind: 'exchange', reason: 'wrong size', lines: [{ variantId: x.variant.id, qty: 1 }] })).body.data;
    for (const st of ['approved', 'received']) expect((await s.patch('returnRequest', r.id, { status: st })).status).toBe(200); expect(await stockOf(s, x.variant.id)).toBe(before + 1);
    expect((await s.patch('returnRequest', r.id, { status: 'refunded', refundAmount: 100 })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await s.patch('returnRequest', r.id, { status: 'exchanged' })).body.error.code).toBe('VALIDATION_ERROR'); expect((await s.patch('returnRequest', r.id, { status: 'exchanged', replacementOrderId: o.id })).status).toBe(400);
    const rep = (await s.create('order', order(x, { lines: [{ variantId: x.v2.id, qty: 1 }] }))).body.data;
    expect((await s.patch('returnRequest', r.id, { status: 'exchanged', replacementOrderId: rep.id })).status).toBe(200);
    expect((await s.get('returnRequest', r.id)).body.data.data).toMatchObject({ status: 'exchanged', replacementOrderId: rep.id }); expect((await s.patch('returnRequest', r.id, { reason: 'x' })).status).not.toBe(200);
    const plain = (await s.create('returnRequest', { orderId: o.id, reason: 'broken', lines: [{ variantId: x.variant.id, qty: 1 }] })).body.data; for (const st of ['approved', 'received']) await s.patch('returnRequest', plain.id, { status: st });
    expect((await s.patch('returnRequest', plain.id, { status: 'exchanged', replacementOrderId: rep.id })).body.error.code).toBe('INVALID_TRANSITION');
  });
});
