import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

const pub = (app: ReturnType<typeof setup>['app'], slug: string, path: string) => request(app).get(`/api/v1/public/catalog/${path}`).set('Host', `${slug}.codela.test`);

describe('fleet: delivery areas and customer invoices', () => {
  it('areas are public only when active; invoices have server totals, no overpay, immutable once paid', async () => {
    const { app } = setup(); const f = await tenantClient(app, 'fleet-c', 'fleet');
    expect((await f.create('area', { name: 'Nasr City', governorate: 'Cairo', estimatedDays: 1 })).status).toBe(201);
    expect((await f.create('area', { name: 'Hidden', active: false })).status).toBe(201);
    const names = ((await pub(app, 'fleet-c', 'area')).body.data as { name: string }[]).map((a) => a.name); expect(names).toEqual(['Nasr City']);
    const cust = (await f.create('customer', { name: 'Shop One', phone: '01001234567' })).body.data;
    const inv = (await f.create('invoice', { customerId: cust.id, lines: [{ desc: 'Shipping', qty: 2, unitPrice: 5000 }], discount: 1000, taxBp: 1400 })).body.data;
    expect(inv.data.subtotal).toBe(10000); expect(inv.data.tax).toBe(1260); expect(inv.data.total).toBe(10260); expect(inv.data.status).toBe('draft');
    expect((await f.create('payment', { invoiceId: inv.id, amount: 100, method: 'cash' })).body.error.code).toBe('INVOICE_NOT_PAYABLE');
    expect((await f.patch('invoice', inv.id, { status: 'issued', lines: inv.data.lines, discount: 1000, taxBp: 1400, customerId: cust.id })).status).toBe(200);
    expect((await f.create('payment', { invoiceId: inv.id, amount: 20000, method: 'cash' })).body.error.code).toBe('OVERPAYMENT');
    await f.create('payment', { invoiceId: inv.id, amount: 5000, method: 'instapay', reference: 'X1' });
    expect((await f.get('invoice', inv.id)).body.data.data.status).toBe('partially_paid');
    await f.create('payment', { invoiceId: inv.id, amount: 5260, method: 'cash' });
    expect((await f.get('invoice', inv.id)).body.data.data.status).toBe('paid');
    expect((await f.patch('invoice', inv.id, { status: 'cancelled' })).status).toBe(409);
  });
});

describe('auto: branches, makes, battery category, purchasing, warranty, booking conversion', () => {
  it('public branches/makes; purchase order receiving adds stock once; warranty end date; booking request converts to an appointment', async () => {
    const { app } = setup(); const a = await tenantClient(app, 'auto-c', 'automotive');
    await a.create('branch', { name: 'Main', address: '1 Road' }); await a.create('branch', { name: 'Closed', active: false });
    expect(((await pub(app, 'auto-c', 'branch')).body.data as { name: string }[]).map((b) => b.name)).toEqual(['Main']);
    await a.create('supportedMake', { make: 'Toyota', models: 'Corolla, Yaris' });
    expect(((await pub(app, 'auto-c', 'supportedMake')).body.data as { make: string }[])[0].make).toBe('Toyota');
    const sup = (await a.create('supplier', { name: 'Parts Co' })).body.data;
    const bat = (await a.create('sparePart', { sku: 'BAT-1', name: 'Battery 70Ah', category: 'battery', price: 250000 })).body.data;
    expect(((await pub(app, 'auto-c', 'sparePart?category=battery')).body.data as { sku: string }[]).map((p) => p.sku)).toEqual(['BAT-1']);
    const po = (await a.create('purchaseOrder', { supplierId: sup.id, lines: [{ partId: bat.id, qty: 10, unitCost: 180000 }] })).body.data;
    expect(po.data.total).toBe(1800000);
    expect((await a.get('sparePart', bat.id)).body.data.data.stock).toBe(0);
    expect((await a.patch('purchaseOrder', po.id, { status: 'received' })).status).toBe(200);
    const after = (await a.get('sparePart', bat.id)).body.data.data; expect(after.stock).toBe(10); expect(after.cost).toBe(180000);
    expect((await a.patch('purchaseOrder', po.id, { status: 'cancelled' })).status).toBe(409);
    expect((await a.get('sparePart', bat.id)).body.data.data.stock).toBe(10);

    const cust = (await a.create('customer', { name: 'Omar', phone: '01001234567' })).body.data;
    const veh = (await a.create('vehicle', { customerId: cust.id, plate: 'abc 1234', make: 'Toyota', model: 'Corolla' })).body.data;
    const w = (await a.create('warranty', { kind: 'part', vehicleId: veh.id, partId: bat.id, description: 'Battery 12 months', startDate: '2030-01-31', months: 1 })).body.data;
    expect(w.data.endDate).toBe('2030-03-03'); // 31 Jan + 1 month overflows like JS dates do; the stored date is deterministic
    expect((await a.create('warranty', { kind: 'service', vehicleId: veh.id, description: 'x', startDate: '2030-01-01', months: 6 })).status).toBe(400);

    const nobody = (await a.create('bookingRequest', { name: 'Ali', phone: '01009998887', plate: 'ZZZ 999', preferredDate: '2030-01-07', preferredTime: '10:00' })).body.data;
    expect((await a.patch('bookingRequest', nobody.id, { status: 'converted' })).body.error.code).toBe('VEHICLE_NOT_FOUND');
    const br = (await a.create('bookingRequest', { name: 'Omar', phone: '01001234567', plate: 'ABC1234', preferredDate: '2030-01-07', preferredTime: '10:00' })).body.data;
    expect((await a.patch('bookingRequest', br.id, { status: 'converted' })).status).toBe(200);
    const done = (await a.get('bookingRequest', br.id)).body.data.data; expect(done.appointmentId).toBeTruthy();
    expect((await a.get('appointment', done.appointmentId)).body.data.data).toMatchObject({ vehicleId: veh.id, date: '2030-01-07', startTime: '10:00' });
  });
});

describe('build: warehouses, transfers and BOQ estimates', () => {
  it('warehouse stock is separate and transfers are atomic; a final estimate creates the quotation with the markup', async () => {
    const { app } = setup(); const b = await tenantClient(app, 'build-c', 'construction');
    const w1 = (await b.create('warehouse', { name: 'Site A' })).body.data, w2 = (await b.create('warehouse', { name: 'Site B' })).body.data;
    const m = (await b.create('material', { sku: 'CEM', name: 'Cement', unit: 'bag', cost: 9000 })).body.data;
    expect((await b.create('materialMovement', { materialId: m.id, type: 'in', qty: 100, warehouseId: w1.id })).status).toBe(201);
    expect((await b.create('materialMovement', { materialId: m.id, type: 'adjust_down', qty: 5, warehouseId: w2.id })).body.error.code).toBe('INSUFFICIENT_STOCK');
    const bal = async (id: string) => ((await b.list('warehouseStockLedger', `?materialId=${m.id}&warehouseId=${id}`)).body.data as { data: { delta: number } }[]).reduce((a, x) => a + x.data.delta, 0);
    expect((await b.create('materialTransfer', { materialId: m.id, fromWarehouseId: w1.id, toWarehouseId: w2.id, qty: 30 })).status).toBe(201);
    expect(await bal(w1.id)).toBe(70); expect(await bal(w2.id)).toBe(30); expect((await b.get('material', m.id)).body.data.data.stock).toBe(100);
    expect((await b.create('materialTransfer', { materialId: m.id, fromWarehouseId: w1.id, toWarehouseId: w2.id, qty: 71 })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await b.create('materialTransfer', { materialId: m.id, fromWarehouseId: w1.id, toWarehouseId: w1.id, qty: 1 })).status).toBe(400);

    const client = (await b.create('client', { name: 'Mr. Owner', phone: '01001234567' })).body.data;
    const est = (await b.create('boqEstimate', { clientId: client.id, title: 'Flat finishing', markupBp: 1000, lines: [{ kind: 'material', desc: 'Tiles', unit: 'm2', qty: 100, unitCost: 20000 }, { kind: 'labour', desc: 'Tiling', qty: 100, unitCost: 5000 }] })).body.data;
    expect(est.data).toMatchObject({ materialCost: 2000000, labourCost: 500000, totalCost: 2500000, sellingPrice: 2750000, status: 'draft' });
    expect((await b.patch('boqEstimate', est.id, { status: 'final' })).status).toBe(200);
    const fin = (await b.get('boqEstimate', est.id)).body.data.data; expect(fin.quotationId).toBeTruthy();
    const q = (await b.get('quotation', fin.quotationId)).body.data.data; expect(q.subtotal).toBe(2750000); expect(q.status).toBe('draft');
    expect((await b.patch('boqEstimate', est.id, { title: 'Changed' })).status).toBe(409);
  });
});

describe('commerce: the catalogue is searched, filtered, sorted and paged on the server (> 100 products)', () => {
  it('q, category, price range, sort and pagination all happen in the API', async () => {
    const { app } = setup(); const s = await tenantClient(app, 'store-c', 'ecommerce');
    const cat = (await s.create('category', { name: 'Shoes' })).body.data;
    for (let i = 1; i <= 120; i++) await s.create('product', { name: `Item ${String(i).padStart(3, '0')}${i % 10 === 0 ? ' red' : ''}`, basePrice: i * 100, status: 'active', ...(i <= 40 ? { categoryId: cat.id } : {}) });
    await s.create('product', { name: 'Hidden draft', basePrice: 100, status: 'draft' });
    const get = (qs: string) => request(app).get(`/api/v1/public/catalog/product?${qs}`).set('Host', 'store-c.codela.test');
    const all = await get('pageSize=50&page=1'); expect(all.body.meta.total).toBe(120); expect(all.body.data).toHaveLength(50);
    expect((await get('pageSize=50&page=3')).body.data).toHaveLength(20);
    expect((await get(`categoryId=${cat.id}`)).body.meta.total).toBe(40);
    expect((await get('q=red')).body.meta.total).toBe(12);
    const range = await get('basePrice_from=5000&basePrice_to=5500&sort=basePrice&dir=asc'); expect(range.body.meta.total).toBe(6);
    expect((range.body.data as { basePrice: number }[]).map((p) => p.basePrice)).toEqual([5000, 5100, 5200, 5300, 5400, 5500]);
    const desc = await get('sort=basePrice&dir=desc&pageSize=3'); expect((desc.body.data as { basePrice: number }[]).map((p) => p.basePrice)).toEqual([12000, 11900, 11800]);
  }, 60_000);
});
