import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const biz = (slug = 'alpha') => tenantClient(ctx.app, slug, 'business');
const host = (slug = 'alpha') => `${slug}.codela.test`;
const today = new Date().toISOString().slice(0, 10);

async function seed(b: TC) {
  const wh = (await b.create('warehouse', { name: 'Main', location: 'Cairo' })).body.data;
  const wh2 = (await b.create('warehouse', { name: 'Branch', location: 'Giza' })).body.data;
  const sup = (await b.create('supplier', { name: 'Parts Supplier', phone: '01111111111' })).body.data;
  const prod = (await b.create('product', { sku: 'W-1', name: 'Widget', unit: 'pcs', price: 10000, cost: 6000, supplierId: sup.id, reorderLevel: 5 })).body.data;
  const cust = (await b.create('customer', { name: 'Acme Co', company: 'Acme', phone: '01001234567', email: 'buyer@acme.test' })).body.data;
  return { wh, wh2, sup, prod, cust };
}
const stockOf = async (b: TC, id: string) => (await b.get('product', id)).body.data.data.stock as number;
const receive = async (b: TC, x: Awaited<ReturnType<typeof seed>>, qty: number, wh = x.wh) => b.create('stockMovement', { productId: x.prod.id, warehouseId: wh.id, type: 'in', qty, reason: 'opening' });
const inv = (x: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ customerId: x.cust.id, warehouseId: x.wh.id, lines: [{ productId: x.prod.id, qty: 3 }], discount: 1000, taxBp: 1400, dueDate: '2030-01-31', ...over });

describe('inventory', () => {
  it('per-warehouse ledger: balances, negative guard, transfers; product total is derived', async () => {
    const b = await biz(); const x = await seed(b);
    expect((await receive(b, x, 20)).status).toBe(201); expect(await stockOf(b, x.prod.id)).toBe(20);
    expect((await b.create('stockMovement', { productId: x.prod.id, warehouseId: x.wh2.id, type: 'out', qty: 1 })).body.error.code).toBe('INSUFFICIENT_STOCK'); // none in the second warehouse
    expect((await b.create('transfer', { productId: x.prod.id, fromWarehouseId: x.wh.id, toWarehouseId: x.wh2.id, qty: 8 })).status).toBe(201);
    expect(await stockOf(b, x.prod.id)).toBe(20); expect((await b.create('stockMovement', { productId: x.prod.id, warehouseId: x.wh2.id, type: 'out', qty: 8 })).status).toBe(201);
    expect((await b.create('transfer', { productId: x.prod.id, fromWarehouseId: x.wh.id, toWarehouseId: x.wh2.id, qty: 13 })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(b, x.prod.id)).toBe(12); expect((await b.create('transfer', { productId: x.prod.id, fromWarehouseId: x.wh.id, toWarehouseId: x.wh.id, qty: 1 })).status).toBe(400);
    expect((await b.patch('product', x.prod.id, { stock: 999, name: 'Widget 2' })).body.data.data.stock).toBe(12); expect((await b.create('product', { sku: 'w-1', name: 'Dup', price: 1 })).status).toBe(409);
    expect((await b.del('warehouse', x.wh.id)).body.error.code).toBe('IN_USE');
  });
  it('purchase orders: totals, lifecycle; receiving adds stock, books an expense and a ledger entry', async () => {
    const b = await biz(); const x = await seed(b);
    const po = (await b.create('purchaseOrder', { supplierId: x.sup.id, warehouseId: x.wh.id, lines: [{ productId: x.prod.id, qty: 10, unitCost: 5500 }], total: 1 })).body.data;
    expect(po.code).toBe('PO-0001'); expect(po.data.total).toBe(55000);
    expect((await b.patch('purchaseOrder', po.id, { status: 'received' })).body.error.code).toBe('INVALID_TRANSITION');
    await b.patch('purchaseOrder', po.id, { status: 'ordered' }); expect((await b.patch('purchaseOrder', po.id, { lines: [{ productId: x.prod.id, qty: 1, unitCost: 1 }] })).body.error.code).toBe('IMMUTABLE');
    expect((await b.patch('purchaseOrder', po.id, { status: 'received' })).status).toBe(200); expect(await stockOf(b, x.prod.id)).toBe(10);
    expect((await b.list('expense')).body.data[0].data).toMatchObject({ category: 'purchases', amount: 55000, source: 'purchase' });
    expect((await b.list('ledgerEntry')).body.data[0].data).toMatchObject({ type: 'expense', amount: 55000 });
    expect((await b.patch('purchaseOrder', po.id, { status: 'cancelled' })).body.error.code).toBe('IMMUTABLE'); expect((await b.del('supplier', x.sup.id)).body.error.code).toBe('IN_USE');
  });
});

describe('sales invoices & payments', () => {
  it('prices come from the catalogue; issuing deducts stock atomically; cancelling returns it', async () => {
    const b = await biz(); const x = await seed(b); await receive(b, x, 2);
    const r = await b.create('invoice', inv(x, { total: 1 })); expect(r.status).toBe(201); const d = r.body.data.data; expect(r.body.data.code).toBe('INV-0001');
    expect(d).toMatchObject({ subtotal: 30000, tax: 4060, total: 33060, paidAmount: 0, status: 'draft' }); expect(d.items[0]).toMatchObject({ sku: 'W-1', unitPrice: 10000, qty: 3, lineTotal: 30000 });
    const fail = await b.patch('invoice', r.body.data.id, { status: 'issued' }); expect(fail.status).toBe(409); expect(fail.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await b.get('invoice', r.body.data.id)).body.data.data.status).toBe('draft'); expect(await stockOf(b, x.prod.id)).toBe(2);
    await receive(b, x, 8); expect((await b.patch('invoice', r.body.data.id, { status: 'issued' })).status).toBe(200); expect(await stockOf(b, x.prod.id)).toBe(7);
    expect((await b.patch('invoice', r.body.data.id, { discount: 0 })).body.error.code).toBe('IMMUTABLE');
    expect((await b.patch('invoice', r.body.data.id, { status: 'cancelled' })).status).toBe(200); expect(await stockOf(b, x.prod.id)).toBe(10);
    expect((await b.create('invoice', inv(x, { discount: 99999999 }))).status).toBe(400); await b.patch('product', x.prod.id, { active: false });
    expect((await b.create('invoice', inv(x))).body.error.code).toBe('NOT_AVAILABLE');
  });
  it('payments: no overpay, partial/paid, ledger income, cancel blocked after payment', async () => {
    const b = await biz(); const x = await seed(b); await receive(b, x, 10); const i = (await b.create('invoice', inv(x))).body.data;
    expect((await b.create('payment', { invoiceId: i.id, amount: 1, method: 'cash' })).body.error.code).toBe('INVOICE_NOT_PAYABLE'); await b.patch('invoice', i.id, { status: 'issued' });
    expect((await b.create('payment', { invoiceId: i.id, amount: 33061, method: 'cash' })).body.error.code).toBe('OVERPAYMENT');
    await b.create('payment', { invoiceId: i.id, amount: 13060, method: 'transfer' }); expect((await b.get('invoice', i.id)).body.data.data.status).toBe('partially_paid');
    expect((await b.patch('invoice', i.id, { status: 'cancelled' })).body.error.code).toBe('IMMUTABLE');
    await b.create('payment', { invoiceId: i.id, amount: 20000, method: 'cash' }); expect((await b.get('invoice', i.id)).body.data.data.status).toBe('paid');
    const led = (await b.list('ledgerEntry', '?type=income')).body.data; expect(led.reduce((a: number, l: { data: { amount: number } }) => a + l.data.amount, 0)).toBe(33060);
    expect((await b.create('ledgerEntry', { type: 'income', amount: 1 })).status).toBe(405); expect((await b.del('ledgerEntry', led[0].id)).status).toBe(405);
    const k = await b.kpis(); expect(k.incomeMonth).toBe(33060); expect(k.outstanding).toBe(0); expect((await b.report('salesByCustomer'))[0]).toEqual({ key: x.cust.id, value: 33060 });
  });
});

describe('CRM', () => {
  it('winning a lead creates (or reuses) the customer; terminal stages are final', async () => {
    const b = await biz(); const x = await seed(b);
    const l = (await b.create('lead', { name: 'New Prospect', phone: '01055556666', company: 'ProspectCo', source: 'website', value: 500000 })).body.data; expect(l.code).toBe('LD-0001'); expect(l.data.stage).toBe('new');
    await b.patch('lead', l.id, { stage: 'qualified' }); const won = await b.patch('lead', l.id, { stage: 'won' }); expect(won.status).toBe(200);
    const cid = won.body.data.data.convertedCustomerId; expect(cid).toBeTruthy(); expect((await b.get('customer', cid)).body.data.data).toMatchObject({ name: 'New Prospect', company: 'ProspectCo' });
    expect((await b.patch('lead', l.id, { stage: 'new' })).body.error.code).toBe('IMMUTABLE');
    const dup = (await b.create('lead', { name: 'Acme Buyer', phone: '٠١٠٠١٢٣٤٥٦٧' })).body.data; const w2 = await b.patch('lead', dup.id, { stage: 'won' }); expect(w2.body.data.data.convertedCustomerId).toBe(x.cust.id);
    expect((await b.list('customer')).body.meta.total).toBe(2);
  });
  it('deal pipeline: weighted value by stage; won/lost are final', async () => {
    const b = await biz(); const x = await seed(b);
    const d = (await b.create('deal', { customerId: x.cust.id, title: 'Annual contract', value: 1000000, expectedClose: '2030-03-01' })).body.data;
    expect(d.data).toMatchObject({ stage: 'prospecting', probabilityBp: 1000, weightedValue: 100000 });
    expect((await b.patch('deal', d.id, { stage: 'proposal' })).body.data.data).toMatchObject({ probabilityBp: 5000, weightedValue: 500000 });
    const k = await b.kpis(); expect(k.openDeals).toBe(1); expect(k.pipelineWeighted).toBe(500000);
    await b.patch('deal', d.id, { stage: 'won' }); expect((await b.patch('deal', d.id, { stage: 'lost' })).body.error.code).toBe('IMMUTABLE');
    expect((await b.kpis()).openDeals).toBe(0); expect((await b.report('dealsByStage'))[0]).toEqual({ key: 'won', value: 1 });
  });
});

describe('finance & HR', () => {
  it('expenses book ledger entries; cashflow report; ledger is immutable', async () => {
    const b = await biz(); await seed(b);
    expect((await b.create('expense', { category: 'rent', amount: 200000, date: today, vendor: 'Landlord' })).status).toBe(201);
    expect((await b.create('expense', { category: 'rent', amount: 1.5, date: today })).status).toBe(400); expect((await b.del('expense', (await b.list('expense')).body.data[0].id)).status).toBe(405);
    expect((await b.list('ledgerEntry')).body.data[0].data).toMatchObject({ type: 'expense', amount: 200000, refType: 'expense' });
    expect((await b.kpis()).expenseMonth).toBe(200000); expect((await b.report('cashflowByType'))[0]).toEqual({ key: 'expense', value: 200000 }); expect((await b.report('expensesByCategory'))[0]).toEqual({ key: 'rent', value: 200000 });
  });
  it('HR records are sensitive (reads audited); tasks link to employees', async () => {
    const b = await biz(); const e = (await b.create('employee', { name: 'Hana Accountant', position: 'Accountant', department: 'Finance', salary: 1500000, hireDate: '2029-01-01', email: 'hana@x.test' })).body.data;
    expect(e.code).toBe('EM-0001'); expect((await b.create('employee', { name: 'Bad', salary: 100.5 })).status).toBe(400); await b.get('employee', e.id);
    expect((await b.agent.get('/api/v1/tenant/audit-logs')).body.data.map((l: { action: string; entityId: string }) => `${l.action}:${l.entityId}`)).toContain(`record.read:${e.id}`);
    const t = await b.create('task', { title: 'Close books', assigneeId: e.id, priority: 'high', dueDate: '2030-01-31' }); expect(t.status).toBe(201); expect(t.body.data.data.status).toBe('todo');
    expect((await b.create('task', { title: 'Bad', assigneeId: e.id.replace(/./, 'x') })).status).toBe(400);
    expect((await b.del('employee', e.id)).body.error.code).toBe('IN_USE');
  });
});

describe('public site & access', () => {
  it('public product catalogue hides cost/stock; inquiry form is tenant-scoped', async () => {
    const b = await biz(); const x = await seed(b); const o = await biz('beta'); await receive(b, x, 5);
    await b.create('product', { sku: 'H-1', name: 'Hidden', price: 1, active: false });
    const get = (p: string) => request(ctx.app).get(`/api/v1/public/catalog/${p}`).set('Host', host());
    const r = await get('product'); expect(r.body.data.map((p: { name: string }) => p.name)).toEqual(['Widget']); expect(JSON.stringify(r.body)).not.toMatch(/cost|stock|supplierId|tenantId/);
    for (const p of ['customer', 'invoice', 'employee', 'ledgerEntry']) expect((await get(p)).status).toBe(404);
    expect((await request(ctx.app).post('/api/v1/public/forms/inquiry').set('Host', host()).send({ name: 'V', phone: '٠١٠١١١١٢٢٢٢', message: 'Need a quote' })).status).toBe(201);
    expect((await b.list('inquiry')).body.meta.total).toBe(1); expect((await o.list('inquiry')).body.meta.total).toBe(0);
  });
  it('employee role: sales and CRM yes; ledger, expenses, HR, purchasing no; search finds everything allowed', async () => {
    const b = await biz(); const x = await seed(b); const e = await employeeAgent(ctx.app, b, 'alpha');
    expect((await e.agent.get('/api/v1/tenant/p/invoice')).status).toBe(200); expect((await e.agent.get('/api/v1/tenant/p/lead')).status).toBe(200);
    for (const ent of ['ledgerEntry', 'expense', 'employee', 'purchaseOrder', 'transfer', 'supplier']) expect((await e.agent.get(`/api/v1/tenant/p/${ent}`)).status, ent).toBe(403);
    expect((await e.agent.get('/api/v1/tenant/dashboard')).body.data.kpis.incomeMonth).toBeUndefined();
    const t = async (q: string, agent = b.agent) => ((await agent.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).body.data as { entityType: string }[]).map((r) => r.entityType);
    expect(await t('acme')).toContain('customer'); expect(await t('widget')).toContain('product'); expect(await t('parts supplier')).toContain('supplier'); expect(await t('W-1')).toContain('product');
    expect(await t('parts supplier', e.agent)).not.toContain('supplier'); expect(x.wh.id).toBeTruthy();
  });
});

describe('stock per warehouse screen data', () => {
  it('balances per product x warehouse follow movements and transfers; employees without stock access and other products are refused', async () => {
    const b = await biz(); const x = await seed(b); await receive(b, x, 20); await b.create('transfer', { productId: x.prod.id, fromWarehouseId: x.wh.id, toWarehouseId: x.wh2.id, qty: 8 });
    await b.create('stockMovement', { productId: x.prod.id, warehouseId: x.wh2.id, type: 'out', qty: 3 });
    const r = (await b.agent.get('/api/v1/tenant/stock-balances')).body.data; expect(r.warehouses.map((w: { name: string }) => w.name).sort()).toEqual(['Branch', 'Main']);
    expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ name: 'Widget', sku: 'W-1', reorderLevel: 5, total: 17, byWarehouse: { [x.wh.id]: 12, [x.wh2.id]: 5 } });
    const other = await tenantClient(ctx.app, 'beta', 'business'); expect((await other.agent.get('/api/v1/tenant/stock-balances')).body.data.rows).toEqual([]); // isolated
    expect((await b.post('/api/v1/tenant/employees', { name: 'Acc', email: 'acc@alpha.test', password: 'Emp-Pass-1234!', role: 'accountant' })).status).toBe(201);
    const acc = request.agent(ctx.app); await acc.post('/api/v1/auth/login').send({ email: 'acc@alpha.test', password: 'Emp-Pass-1234!' }); expect((await acc.get('/api/v1/tenant/stock-balances')).status).toBe(403); // the accountant has no stock module
    const med = await tenantClient(ctx.app, 'clinic', 'medical'); expect((await med.agent.get('/api/v1/tenant/stock-balances')).status).toBe(404);
  });
});
