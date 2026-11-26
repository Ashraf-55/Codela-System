import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const rest = (slug = 'alpha') => tenantClient(ctx.app, slug, 'restaurant');
const host = (slug = 'alpha') => `${slug}.codela.test`;

async function seed(r: TC, beefStock = 1000) {
  const cat = (await r.create('menuCategory', { name: 'Mains', sortOrder: 1 })).body.data;
  const burger = (await r.create('menuItem', { name: 'Burger', categoryId: cat.id, price: 15000, extras: [{ name: 'Cheese', price: 2000 }, { name: 'Bacon', price: 3000 }], prepTimeMin: 12 })).body.data;
  const fries = (await r.create('menuItem', { name: 'Fries', categoryId: cat.id, price: 6000 })).body.data;
  const table = (await r.create('restaurantTable', { number: 'T1', seats: 4, zone: 'Indoor' })).body.data;
  const beef = (await r.create('ingredient', { name: 'Beef', unit: 'g', reorderLevel: 200 })).body.data;
  if (beefStock) await r.create('ingredientMovement', { ingredientId: beef.id, type: 'in', qty: beefStock, reason: 'purchase' });
  await r.create('recipe', { itemId: burger.id, lines: [{ ingredientId: beef.id, qty: 150 }] });
  return { cat, burger, fries, table, beef };
}
const lines = (x: Awaited<ReturnType<typeof seed>>) => [{ itemId: x.burger.id, qty: 2, extras: 'Cheese, bacon', note: 'no onion' }, { itemId: x.fries.id, qty: 1 }];
const dine = (x: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ type: 'dine_in', tableId: x.table.id, lines: lines(x), ...over });
const stock = async (r: TC, id: string) => (await r.get('ingredient', id)).body.data.data.stock as number;
const walk = async (r: TC, id: string, ...st: string[]) => { for (const s of st) expect((await r.patch('order', id, { status: s })).status).toBe(200); };

describe('menu & ingredients', () => {
  it('menu CRUD with extras validation; ingredient stock is ledger-driven', async () => {
    const r = await rest(); const x = await seed(r);
    expect(x.burger.data.available).toBe(true); expect(await stock(r, x.beef.id)).toBe(1000);
    expect((await r.create('menuItem', { name: 'Bad', categoryId: x.cat.id, price: 10.5 })).status).toBe(400);
    expect((await r.create('menuItem', { name: 'Bad', categoryId: x.cat.id, price: 100, extras: [{ name: 'X', price: -1 }] })).status).toBe(400);
    const over = await r.create('ingredientMovement', { ingredientId: x.beef.id, type: 'out', qty: 5000 }); expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await r.create('recipe', { itemId: x.burger.id, lines: [{ ingredientId: x.beef.id, qty: 1 }] })).status).toBe(409); // one recipe per item
    expect((await r.del('ingredient', x.beef.id)).body.error.code).toBe('IN_USE');
  });
});

describe('orders: pricing & tables', () => {
  it('computes extras, discount, service charge and tax exactly; ignores client prices', async () => {
    const r = await rest(); const x = await seed(r);
    const o = await r.create('order', dine(x, { discount: 1000, serviceBp: 1200, taxBp: 1400, total: 1 }));
    expect(o.status).toBe(201); const d = o.body.data.data; expect(o.body.data.code).toBe('ORD-0001');
    expect(d.items[0]).toMatchObject({ name: 'Burger', unitPrice: 20000, qty: 2, lineTotal: 40000, extras: ['Cheese', 'Bacon'] });
    expect(d.subtotal).toBe(46000); expect(d.serviceCharge).toBe(5400); expect(d.tax).toBe(7056); expect(d.total).toBe(57456);
    expect(d.status).toBe('new'); expect(d.paymentStatus).toBe('unpaid');
    expect((await r.get('restaurantTable', x.table.id)).body.data.data.status).toBe('occupied');
  });
  it('validates order shape: table for dine-in, delivery contact, unknown extras, unavailable items, out-of-service tables', async () => {
    const r = await rest(); const x = await seed(r);
    expect((await r.create('order', { type: 'dine_in', lines: lines(x) })).status).toBe(400);
    expect((await r.create('order', { type: 'takeaway', lines: lines(x) })).status).toBe(201);
    expect((await r.create('order', { type: 'delivery', lines: lines(x) })).status).toBe(400);
    expect((await r.create('order', { type: 'delivery', customerPhone: '01001234567', address: '5 Nile', lines: lines(x) })).status).toBe(201);
    expect((await r.create('order', { type: 'takeaway', lines: [{ itemId: x.burger.id, qty: 1, extras: 'Truffle' }] })).status).toBe(400);
    await r.patch('menuItem', x.fries.id, { available: false });
    expect((await r.create('order', { type: 'takeaway', lines: [{ itemId: x.fries.id, qty: 1 }] })).body.error.code).toBe('NOT_AVAILABLE');
    await r.patch('restaurantTable', x.table.id, { status: 'out_of_service' });
    expect((await r.create('order', dine(x))).body.error.code).toBe('TABLE_UNAVAILABLE');
  });
});

describe('kitchen workflow, inventory & payment', () => {
  it('deducts recipe ingredients when preparing; insufficient stock blocks the transition atomically', async () => {
    const r = await rest(); const x = await seed(r, 250);
    const o = (await r.create('order', dine(x))).body.data; // 2 burgers => 300g needed
    const bad = await r.patch('order', o.id, { status: 'preparing' }); expect(bad.status).toBe(409); expect(bad.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await r.get('order', o.id)).body.data.data.status).toBe('new'); expect(await stock(r, x.beef.id)).toBe(250);
    await r.create('ingredientMovement', { ingredientId: x.beef.id, type: 'in', qty: 750 });
    await walk(r, o.id, 'preparing'); expect(await stock(r, x.beef.id)).toBe(700);
  });
  it('cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order type', async () => {
    const r = await rest(); const x = await seed(r);
    const a = (await r.create('order', dine(x))).body.data; await walk(r, a.id, 'preparing', 'cancelled');
    expect(await stock(r, x.beef.id)).toBe(1000);
    const b = (await r.create('order', dine(x, { tableId: undefined, type: 'takeaway' }))).body.data; await walk(r, b.id, 'preparing', 'ready');
    expect((await r.patch('order', b.id, { status: 'cancelled' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await r.patch('order', b.id, { status: 'served' })).body.error.code).toBe('INVALID_TRANSITION'); // takeaway is never "served"
    expect((await r.patch('order', a.id, { status: 'preparing' })).body.error.code).toBe('IMMUTABLE');
  });
  it('payment sets paidAt and creates one invoice; completion requires payment and frees the table', async () => {
    const r = await rest(); const x = await seed(r); const o = (await r.create('order', dine(x, { taxBp: 1400 }))).body.data;
    await walk(r, o.id, 'preparing', 'ready', 'served');
    expect((await r.patch('order', o.id, { status: 'completed' })).body.error.code).toBe('UNPAID');
    expect((await r.patch('order', o.id, { paymentStatus: 'paid' })).status).toBe(400); // method required
    const p = await r.patch('order', o.id, { paymentStatus: 'paid', paymentMethod: 'cash' }); expect(p.status).toBe(200); expect(p.body.data.data.paidAt).toBeTruthy();
    const inv = (await r.list('invoice')).body.data; expect(inv).toHaveLength(1); expect(inv[0].data.total).toBe(o.data.total);
    expect((await r.patch('order', o.id, { paymentStatus: 'unpaid' })).status).toBe(409);
    await walk(r, o.id, 'completed');
    expect((await r.get('restaurantTable', x.table.id)).body.data.data.status).toBe('free');
    expect((await r.patch('order', o.id, { notes: 'x' })).body.error.code).toBe('IMMUTABLE');
  });
  it('kitchen display = orders filtered by status; delivery goes out_for_delivery', async () => {
    const r = await rest(); const x = await seed(r);
    const o1 = (await r.create('order', dine(x))).body.data; const o2 = (await r.create('order', { type: 'delivery', customerPhone: '01001234567', address: '5 Nile', lines: lines(x) })).body.data;
    await walk(r, o2.id, 'preparing', 'ready', 'out_for_delivery');
    expect((await r.list('order', '?status=new')).body.data.map((o: { id: string }) => o.id)).toEqual([o1.id]);
    expect((await r.list('order', '?status=out_for_delivery')).body.meta.total).toBe(1);
  });
});

describe('cashier shifts', () => {
  it('one open shift; closing computes expected cash and difference; closed shifts are immutable', async () => {
    const r = await rest(); const x = await seed(r);
    const sh = (await r.create('shift', { openingCash: 10000 })).body.data; expect(sh.data.status).toBe('open');
    expect((await r.create('shift', { openingCash: 1 })).body.error.code).toBe('SHIFT_OPEN');
    const o = (await r.create('order', { type: 'takeaway', lines: lines(x), discount: 1000, serviceBp: 1200, taxBp: 1400 })).body.data;
    await r.patch('order', o.id, { paymentStatus: 'paid', paymentMethod: 'cash' });
    const o2 = (await r.create('order', { type: 'takeaway', lines: [{ itemId: x.fries.id, qty: 1 }] })).body.data; await r.patch('order', o2.id, { paymentStatus: 'paid', paymentMethod: 'card' });
    const c = await r.patch('shift', sh.id, { status: 'closed', closingCash: 67000 });
    expect(c.status).toBe(200); expect(c.body.data.data.expectedCash).toBe(10000 + 57456); expect(c.body.data.data.difference).toBe(-456); expect(c.body.data.data.closedAt).toBeTruthy();
    expect((await r.patch('shift', sh.id, { closingCash: 1 })).body.error.code).toBe('IMMUTABLE');
    expect((await r.create('shift', { openingCash: 5 })).status).toBe(201);
  });
  it('closing requires closingCash', async () => { const r = await rest(); const sh = (await r.create('shift', { openingCash: 0 })).body.data; expect((await r.patch('shift', sh.id, { status: 'closed' })).status).toBe(400); });
});

describe('reservations', () => {
  const res = (t: TC, x: Awaited<ReturnType<typeof seed>>, over: object = {}) => t.create('reservation', { name: 'Mona', phone: '01001234567', date: '2030-03-01', time: '20:00', partySize: 4, tableId: x.table.id, ...over });
  it('prevents table clashes and oversize parties; confirmation needs a table', async () => {
    const r = await rest(); const x = await seed(r);
    expect((await res(r, x)).status).toBe(201);
    expect((await res(r, x, { time: '21:00' })).body.error.code).toBe('TABLE_TAKEN'); // 90 min default overlaps
    expect((await res(r, x, { time: '21:30' })).status).toBe(201);
    expect((await res(r, x, { date: '2030-03-02', partySize: 6 })).body.error.code).toBe('TABLE_TOO_SMALL');
    const noTable = (await res(r, x, { tableId: undefined, date: '2030-03-05' })).body.data;
    expect(noTable.data.status).toBe('requested'); expect((await r.patch('reservation', noTable.id, { status: 'confirmed' })).body.error.code).toBe('TABLE_REQUIRED');
    expect((await r.patch('reservation', noTable.id, { status: 'confirmed', tableId: x.table.id })).status).toBe(200);
    expect((await r.patch('reservation', noTable.id, { status: 'completed' })).body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('public website', () => {
  it('menu shows only available items; branches public; tables/recipes private', async () => {
    const r = await rest(); const x = await seed(r); await r.patch('menuItem', x.fries.id, { available: false });
    await r.create('branch', { name: 'Zamalek', address: '1 Nile', phone: '01001234567', hours: '10-24' });
    const get = (p: string) => request(ctx.app).get(`/api/v1/public/catalog/${p}`).set('Host', host());
    expect((await get('menuItem')).body.data.map((i: { name: string }) => i.name)).toEqual(['Burger']);
    expect(JSON.stringify((await get('menuItem')).body)).not.toMatch(/tenantId/); expect((await get('branch')).body.data[0].name).toBe('Zamalek');
    expect((await get('menuCategory')).body.data).toHaveLength(1); expect((await get('restaurantTable')).status).toBe(404); expect((await get('recipe')).status).toBe(404);
  });
  it('online order (takeaway/delivery only) and tracking by phone; reservation form; isolation', async () => {
    const r = await rest(); const x = await seed(r); const o = await rest('beta'); await seed(o);
    const post = (a: string, b: object, h = host()) => request(ctx.app).post(`/api/v1/public/actions/${a}`).set('Host', h).send(b);
    const ok = await post('order', { customer: { name: 'Web', phone: '٠١٠٠٩٩٩٨٨٨٨' }, type: 'takeaway', lines: [{ itemId: x.fries.id, qty: 2 }] });
    expect(ok.status).toBe(201); expect(ok.body.data.total).toBe(12000);
    expect((await post('order', { customer: { name: 'Web', phone: '01009998888' }, type: 'dine_in', lines: [{ itemId: x.fries.id, qty: 1 }] })).status).toBe(400);
    expect((await post('order', { customer: { name: 'Web', phone: '01009998888' }, type: 'delivery', lines: [{ itemId: x.fries.id, qty: 1 }] })).status).toBe(400);
    expect((await post('order', { customer: { name: 'Web', phone: '01009998888' }, type: 'takeaway', lines: [{ itemId: x.fries.id, qty: 1 }] }, host('beta'))).status).toBe(400); // other tenant's item
    const t = await request(ctx.app).get(`/api/v1/public/actions/track?code=${ok.body.data.orderCode}&phone=01009998888`).set('Host', host());
    expect(t.status).toBe(200); expect(t.body.data.status).toBe('new');
    expect((await request(ctx.app).get(`/api/v1/public/actions/track?code=${ok.body.data.orderCode}&phone=01000000000`).set('Host', host())).status).toBe(404);
    const rv = await request(ctx.app).post('/api/v1/public/forms/reservation').set('Host', host()).send({ name: 'Guest', phone: '01011112222', date: '2030-04-01', time: '19:00', partySize: 2, tableId: x.table.id });
    expect(rv.status).toBe(201); expect((await r.list('reservation')).body.data[0].data.tableId).toBeUndefined(); // tableId is not accepted from the public
  });
});

describe('permissions, KPIs, reports, search', () => {
  it('employee runs orders but cannot see recipes/ingredient ledger edits/shifts reports; KPIs real', async () => {
    const r = await rest(); const x = await seed(r); const e = await employeeAgent(ctx.app, r, 'alpha');
    expect((await e.agent.get('/api/v1/tenant/p/order')).status).toBe(200); expect((await e.agent.get('/api/v1/tenant/p/recipe')).status).toBe(403);
    expect((await e.agent.post('/api/v1/tenant/p/ingredientMovement').set('x-csrf-token', e.csrf).send({ ingredientId: x.beef.id, type: 'in', qty: 1 })).status).toBe(403);
    expect((await e.agent.post('/api/v1/tenant/p/order').set('x-csrf-token', e.csrf).send(dine(x))).status).toBe(201);
    const o = (await r.list('order')).body.data[0]; await r.patch('order', o.id, { paymentStatus: 'paid', paymentMethod: 'cash' });
    const k = await r.kpis(); expect(k.ordersToday).toBe(1); expect(k.salesToday).toBe(o.data.total); expect(k.openOrders).toBe(1); expect(k.tablesOccupied).toBe(1);
    expect((await r.report('ordersByType'))[0]).toEqual({ key: 'dine_in', value: 1 }); expect((await r.report('salesByMethod'))[0]).toEqual({ key: 'cash', value: o.data.total });
  });
  it('global search: menu items, tables, reservations, orders', async () => {
    const r = await rest(); const x = await seed(r); const o = (await r.create('order', dine(x))).body.data;
    await r.create('reservation', { name: 'Layla Guest', phone: '01055556666', date: '2030-05-01', time: '18:00', partySize: 2 });
    const t = async (q: string) => (await r.search(q)).map((s) => s.entityType);
    expect(await t('burger')).toContain('menuItem'); expect(await t('T1')).toContain('restaurantTable'); expect(await t('layla')).toContain('reservation'); expect(await t(o.code)).toContain('order');
  });
});

describe('POS orders use the business default tax', () => {
  it('a POS order that does not state a tax rate gets the tenant default; an explicit rate wins', async () => {
    const c = await tenantClient(ctx.app, 'taxy', 'restaurant');
    expect((await c.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', c.csrf).send({ taxBp: 1400 })).status).toBe(200);
    const cat = (await c.create('menuCategory', { name: 'Mains' })).body.data; const it = (await c.create('menuItem', { name: 'Burger', categoryId: cat.id, price: 10000 })).body.data;
    const o1 = (await c.create('order', { type: 'takeaway', lines: [{ itemId: it.id, qty: 1 }] })).body.data; expect(o1.data).toMatchObject({ subtotal: 10000, tax: 1400, total: 11400, taxBp: 1400 });
    const o2 = (await c.create('order', { type: 'takeaway', taxBp: 0, lines: [{ itemId: it.id, qty: 1 }] })).body.data; expect(o2.data.total).toBe(10000);
  });
});

describe('suppliers, purchasing, waste and offers', () => {
  it('a purchase computes its total on the server and receiving it adds each ingredient to stock exactly once; terminal purchases are immutable', async () => {
    const c = await rest(); const sup = (await c.create('supplier', { name: 'Fresh Farms', phone: '01001230000' })).body.data;
    const a = (await c.create('ingredient', { name: 'Tomato', unit: 'kg' })).body.data; const b = (await c.create('ingredient', { name: 'Cheese', unit: 'kg' })).body.data;
    const p = (await c.create('purchase', { supplierId: sup.id, total: 1, status: 'received', lines: [{ ingredientId: a.id, qty: 10, unitCost: 3000 }, { ingredientId: b.id, qty: 5, unitCost: 12000 }] })).body.data;
    expect(p.data).toMatchObject({ status: 'draft', total: 90000 }); const stock = async (id: string) => (await c.get('ingredient', id)).body.data.data.stock;
    expect(await stock(a.id)).toBe(0); // a draft changes nothing
    expect((await c.patch('purchase', p.id, { status: 'received', total: 5, lines: [] })).status).toBe(200);
    expect(await stock(a.id)).toBe(10); expect(await stock(b.id)).toBe(5);
    const got = (await c.get('purchase', p.id)).body.data.data; expect(got.total).toBe(90000); expect(got.receivedAt).toBeTruthy();
    expect((await c.patch('purchase', p.id, { status: 'cancelled' })).status).not.toBe(200); expect(await stock(a.id)).toBe(10);
    const p2 = (await c.create('purchase', { supplierId: sup.id, lines: [{ ingredientId: a.id, qty: 1, unitCost: 100 }] })).body.data; expect((await c.patch('purchase', p2.id, { status: 'cancelled' })).status).toBe(200); expect(await stock(a.id)).toBe(10);
  });
  it('waste is recorded through the ledger and cannot exceed stock; only active offers are public', async () => {
    const c = await rest(); const a = (await c.create('ingredient', { name: 'Lettuce', unit: 'kg' })).body.data;
    await c.create('ingredientMovement', { ingredientId: a.id, type: 'in', qty: 10 }); expect((await c.create('ingredientMovement', { ingredientId: a.id, type: 'waste', qty: 3, reason: 'spoiled' })).status).toBe(201);
    expect((await c.create('ingredientMovement', { ingredientId: a.id, type: 'waste', qty: 50 })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await c.get('ingredient', a.id)).body.data.data.stock).toBe(7);
    await c.create('promotion', { title: 'Lunch deal', description: '20% off' }); await c.create('promotion', { title: 'Old deal', active: false });
    const pub = await request(ctx.app).get('/api/v1/public/catalog/promotion').set('Host', 'alpha.codela.test'); expect(pub.body.data.map((x: { title: string }) => x.title)).toEqual(['Lunch deal']);
  });
});

describe('profit, split bills, table transfer, supplier payments', () => {
  const setupMenu = async (c: TC) => {
    const cat = (await c.create('menuCategory', { name: 'Mains' })).body.data; const flour = (await c.create('ingredient', { name: 'Flour', unit: 'g' })).body.data; const sup = (await c.create('supplier', { name: 'Mill Co' })).body.data;
    const it = (await c.create('menuItem', { name: 'Pizza', categoryId: cat.id, price: 10000 })).body.data; await c.create('recipe', { itemId: it.id, lines: [{ ingredientId: flour.id, qty: 100 }] });
    const pu = (await c.create('purchase', { supplierId: sup.id, lines: [{ ingredientId: flour.id, qty: 1000, unitCost: 2 }] })).body.data; await c.patch('purchase', pu.id, { status: 'received' });
    return { it, flour, sup, pu };
  };
  const kpis = (c: TC) => c.kpis();

  it('profit = sales - cost of goods (recipe qty x purchase cost) - waste; cancelling while preparing gives the cost back; supplier debt is tracked', async () => {
    const c = await rest(); const { it, flour, pu } = await setupMenu(c);
    expect((await c.get('ingredient', flour.id)).body.data.data.unitCost).toBe(2);
    const o = (await c.create('order', { type: 'takeaway', taxBp: 0, lines: [{ itemId: it.id, qty: 2 }] })).body.data; await c.patch('order', o.id, { status: 'preparing' }); // consumes 200 g = 400
    await c.patch('order', o.id, { paymentStatus: 'paid', paymentMethod: 'cash' });
    await c.create('ingredientMovement', { ingredientId: flour.id, type: 'waste', qty: 50, reason: 'dropped' }); // 100
    let k = await kpis(c); expect(k).toMatchObject({ salesMonth: 20000, cogsMonth: 400, wasteCostMonth: 100, grossProfitMonth: 19500, supplierDue: 2000 });
    const o2 = (await c.create('order', { type: 'takeaway', taxBp: 0, lines: [{ itemId: it.id, qty: 1 }] })).body.data; await c.patch('order', o2.id, { status: 'preparing' }); await c.patch('order', o2.id, { status: 'cancelled' });
    k = await kpis(c); expect(k.cogsMonth).toBe(400); // consumed 200 then returned 200
    expect((await c.create('supplierPayment', { purchaseId: pu.id, amount: 3000, method: 'cash' })).body.error.code).toBe('OVERPAYMENT');
    expect((await c.create('supplierPayment', { purchaseId: pu.id, amount: 500, method: 'bank' })).status).toBe(201);
    expect((await c.get('purchase', pu.id)).body.data.data).toMatchObject({ paidAmount: 500, paymentStatus: 'partial' }); expect((await kpis(c)).supplierDue).toBe(1500);
    await c.create('supplierPayment', { purchaseId: pu.id, amount: 1500, method: 'cash' }); expect((await c.get('purchase', pu.id)).body.data.data.paymentStatus).toBe('paid');
    const draft = (await c.create('purchase', { supplierId: pu.data.supplierId, lines: [{ ingredientId: flour.id, qty: 1, unitCost: 9 }] })).body.data; expect((await c.create('supplierPayment', { purchaseId: draft.id, amount: 1, method: 'cash' })).body.error.code).toBe('NOT_RECEIVED');
  });

  it('a bill can be split into several payments; the order is paid and invoiced only when they add up to the total', async () => {
    const c = await rest(); const { it } = await setupMenu(c);
    const o = (await c.create('order', { type: 'takeaway', taxBp: 0, lines: [{ itemId: it.id, qty: 3 }] })).body.data; expect(o.data.total).toBe(30000);
    expect((await c.create('orderPayment', { orderId: o.id, amount: 10000, method: 'cash' })).status).toBe(201);
    expect((await c.get('order', o.id)).body.data.data.paymentStatus).toBe('unpaid'); expect((await c.list('invoice')).body.data).toHaveLength(0);
    expect((await c.create('orderPayment', { orderId: o.id, amount: 25000, method: 'card' })).body.error.code).toBe('OVERPAYMENT');
    expect((await c.create('orderPayment', { orderId: o.id, amount: 20000, method: 'card' })).status).toBe(201);
    expect((await c.get('order', o.id)).body.data.data).toMatchObject({ paymentStatus: 'paid', paymentMethod: 'mixed' }); expect((await c.list('invoice')).body.data).toHaveLength(1);
    expect((await c.create('orderPayment', { orderId: o.id, amount: 1, method: 'cash' })).body.error.code).toBe('NOT_PAYABLE');
  });

  it('an open dine-in order can move to a free table; the old table is freed and the new one occupied; busy/other-type moves are refused', async () => {
    const c = await rest(); const { it } = await setupMenu(c);
    const t1 = (await c.create('restaurantTable', { number: 'T1', seats: 4 })).body.data; const t2 = (await c.create('restaurantTable', { number: 'T2', seats: 4 })).body.data; const t3 = (await c.create('restaurantTable', { number: 'T3', seats: 4 })).body.data;
    const o = (await c.create('order', { type: 'dine_in', tableId: t1.id, lines: [{ itemId: it.id, qty: 1 }] })).body.data; const st = async (id: string) => (await c.get('restaurantTable', id)).body.data.data.status;
    await c.create('order', { type: 'dine_in', tableId: t3.id, lines: [{ itemId: it.id, qty: 1 }] });
    expect((await c.patch('order', o.id, { tableId: t3.id })).body.error.code).toBe('TABLE_BUSY');
    expect((await c.patch('order', o.id, { tableId: t2.id })).status).toBe(200); expect(await st(t1.id)).toBe('free'); expect(await st(t2.id)).toBe('occupied');
    const tk = (await c.create('order', { type: 'takeaway', lines: [{ itemId: it.id, qty: 1 }] })).body.data; expect((await c.patch('order', tk.id, { tableId: t1.id })).body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('per-branch inventory', () => {
  const bal = async (r: TC, ingredientId: string, branchId: string) =>
    ((await r.list('branchStockLedger', `?ingredientId=${ingredientId}&branchId=${branchId}`)).body.data as { data: { delta: number } }[]).reduce((a, x) => a + x.data.delta, 0);

  it('branch stock is separate: movements, order deductions and transfers never touch another branch', async () => {
    const r = await rest(); const x = await seed(r, 0);
    const b1 = (await r.create('branch', { name: 'Zamalek' })).body.data, b2 = (await r.create('branch', { name: 'Maadi' })).body.data;
    expect((await r.create('ingredientMovement', { ingredientId: x.beef.id, type: 'in', qty: 1000, branchId: b1.id })).status).toBe(201);
    expect(await bal(r, x.beef.id, b1.id)).toBe(1000); expect(await bal(r, x.beef.id, b2.id)).toBe(0); expect(await stock(r, x.beef.id)).toBe(1000);
    // the second branch cannot use the first branch's stock
    expect((await r.create('ingredientMovement', { ingredientId: x.beef.id, type: 'waste', qty: 10, branchId: b2.id })).body.error.code).toBe('INSUFFICIENT_STOCK');
    // an order deducts the recipe from the order's own branch only
    const o = (await r.create('order', dine(x, { branchId: b1.id }))).body.data; await walk(r, o.id, 'preparing');
    expect(await bal(r, x.beef.id, b1.id)).toBe(700); expect(await bal(r, x.beef.id, b2.id)).toBe(0);
    const o2 = (await r.create('order', { type: 'takeaway', branchId: b2.id, lines: [{ itemId: x.burger.id, qty: 1 }] })).body.data;
    expect((await r.patch('order', o2.id, { status: 'preparing' })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await bal(r, x.beef.id, b1.id)).toBe(700);
    // cancelling while preparing gives the stock back to the same branch
    await walk(r, o.id, 'cancelled'); expect(await bal(r, x.beef.id, b1.id)).toBe(1000);
    // transfers: atomic, two ledger rows, total unchanged, cannot exceed the source balance or use one branch twice
    expect((await r.create('ingredientTransfer', { ingredientId: x.beef.id, fromBranchId: b1.id, toBranchId: b2.id, qty: 400 })).status).toBe(201);
    expect(await bal(r, x.beef.id, b1.id)).toBe(600); expect(await bal(r, x.beef.id, b2.id)).toBe(400); expect(await stock(r, x.beef.id)).toBe(1000);
    expect((await r.list('branchStockLedger', '?kind=transfer_out')).body.meta.total).toBe(1); expect((await r.list('branchStockLedger', '?kind=transfer_in')).body.meta.total).toBe(1);
    expect((await r.create('ingredientTransfer', { ingredientId: x.beef.id, fromBranchId: b1.id, toBranchId: b2.id, qty: 601 })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await r.create('ingredientTransfer', { ingredientId: x.beef.id, fromBranchId: b1.id, toBranchId: b1.id, qty: 1 })).status).toBe(400);
    expect(await bal(r, x.beef.id, b1.id)).toBe(600); expect(await bal(r, x.beef.id, b2.id)).toBe(400);
  });

  it('the ledger is system-written only and isolated between tenants', async () => {
    const a = await rest('alpha'); const b = await rest('beta'); const x = await seed(a, 0);
    const br = (await a.create('branch', { name: 'Zamalek' })).body.data; const brB = (await b.create('branch', { name: 'Other' })).body.data;
    expect((await a.create('branchStockLedger', { ingredientId: x.beef.id, branchId: br.id, delta: 999 })).status).not.toBe(201);
    // a branch of another tenant is not a valid reference
    expect((await a.create('ingredientMovement', { ingredientId: x.beef.id, type: 'in', qty: 5, branchId: brB.id })).status).toBe(400);
    await a.create('ingredientMovement', { ingredientId: x.beef.id, type: 'in', qty: 50, branchId: br.id });
    expect((await b.list('branchStockLedger')).body.meta.total).toBe(0);
    expect((await a.get('ingredient', x.beef.id)).body.data.data.stock).toBe(50);
  });
});
