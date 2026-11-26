import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const shop = (slug = 'alpha') => tenantClient(ctx.app, slug, 'automotive');
const host = (slug = 'alpha') => `${slug}.codela.test`;

async function seed(g: TC, stock = 10) {
  const cust = (await g.create('customer', { name: 'Hassan Driver', phone: '01001234567' })).body.data;
  const veh = (await g.create('vehicle', { customerId: cust.id, plate: 'abc 1234', make: 'Toyota', model: 'Corolla', year: 2018, vin: 'VIN123456', odometer: 80000 })).body.data;
  const svc = (await g.create('service', { name: 'Oil change', price: 30000, durationMin: 45 })).body.data;
  const tech = (await g.create('technician', { name: 'Tarek Tech', specialty: 'Engine' })).body.data;
  const part = (await g.create('sparePart', { sku: 'OF-1', name: 'Oil filter', brand: 'Bosch', compatibility: 'Corolla 2015-2020', price: 8000, cost: 5000 })).body.data;
  if (stock) await g.create('partMovement', { partId: part.id, type: 'in', qty: stock, reason: 'purchase' });
  return { cust, veh, svc, tech, part };
}
const wo = (x: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ vehicleId: x.veh.id, technicianId: x.tech.id, complaint: 'Service due', odometerIn: 80500,
  services: [{ serviceId: x.svc.id, qty: 1 }], parts: [{ partId: x.part.id, qty: 2 }], discount: 1000, taxBp: 1400, ...over });
const stockOf = async (g: TC, id: string) => (await g.get('sparePart', id)).body.data.data.stock as number;
const walk = async (g: TC, id: string, ...st: string[]) => { for (const s of st) expect((await g.patch('workOrder', id, { status: s })).status, s).toBe(200); };

describe('vehicles, customers, parts', () => {
  it('vehicles normalise plates, are unique per tenant, searchable by plate/VIN/make', async () => {
    const g = await shop(); const x = await seed(g); const o = await shop('beta');
    expect(x.veh.data.plate).toBe('ABC 1234'); expect(x.veh.code).toBe('VH-0001');
    expect((await g.create('vehicle', { customerId: x.cust.id, plate: 'ABC  1234', make: 'X', model: 'Y' })).status).toBe(409);
    expect((await g.list('vehicle', '?q=abc1234')).body.meta.total).toBe(1);
    expect((await g.list('vehicle', '?q=vin1234')).body.meta.total).toBe(1); expect((await g.list('vehicle', '?q=toyota')).body.meta.total).toBe(1);
    const oc = (await o.create('customer', { name: 'Other Owner' })).body.data;
    expect((await o.create('vehicle', { customerId: oc.id, plate: 'ABC 1234', make: 'Kia', model: 'Rio' })).status).toBe(201);
    expect((await o.create('vehicle', { customerId: x.cust.id, plate: 'ZZZ 1', make: 'Kia', model: 'Rio' })).body.error.code).toBe('REFERENCE_NOT_FOUND');
  });
  it('spare parts: ledger-driven stock, unique SKU, no negative stock', async () => {
    const g = await shop(); const x = await seed(g);
    expect(await stockOf(g, x.part.id)).toBe(10); expect((await g.create('sparePart', { sku: 'of-1', name: 'Dup', price: 1 })).status).toBe(409);
    expect((await g.create('partMovement', { partId: x.part.id, type: 'out', qty: 11 })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await g.patch('sparePart', x.part.id, { stock: 999, name: 'Oil filter 2' })).body.data.data.stock).toBe(10);
  });
});

describe('maintenance appointments', () => {
  it('prevents overlapping bookings for the same technician or vehicle; transitions validated', async () => {
    const g = await shop(); const x = await seed(g);
    const a = (over: object = {}) => g.create('appointment', { vehicleId: x.veh.id, serviceId: x.svc.id, technicianId: x.tech.id, date: '2030-06-01', startTime: '10:00', durationMin: 60, ...over });
    const first = await a(); expect(first.status).toBe(201);
    expect((await a({ startTime: '10:30' })).body.error.code).toBe('SLOT_TAKEN');
    const v2 = (await g.create('vehicle', { customerId: x.cust.id, plate: 'XYZ 9', make: 'Kia', model: 'Rio' })).body.data;
    expect((await a({ vehicleId: v2.id, startTime: '10:30' })).body.error.code).toBe('SLOT_TAKEN'); // same technician
    expect((await a({ vehicleId: v2.id, technicianId: undefined, startTime: '10:30' })).status).toBe(201);
    expect((await a({ startTime: '11:00' })).status).toBe(201);
    expect((await g.patch('appointment', first.body.data.id, { status: 'completed' })).body.error.code).toBe('INVALID_TRANSITION');
    await g.patch('appointment', first.body.data.id, { status: 'cancelled' }); expect((await a({ startTime: '10:00' })).status).toBe(201);
  });
});

describe('work orders', () => {
  it('computes labour+parts totals from the catalogue with integer math', async () => {
    const g = await shop(); const x = await seed(g);
    const r = await g.create('workOrder', wo(x, { total: 1 })); expect(r.status).toBe(201);
    const d = r.body.data.data; expect(r.body.data.code).toBe('WO-0001');
    expect(d.laborTotal).toBe(30000); expect(d.partsTotal).toBe(16000); expect(d.tax).toBe(6300); expect(d.total).toBe(51300); expect(d.status).toBe('open');
    expect(d.partItems[0]).toMatchObject({ sku: 'OF-1', unitPrice: 8000, qty: 2 }); expect(await stockOf(g, x.part.id)).toBe(10); // not consumed yet
    expect((await g.create('workOrder', wo(x, { discount: 999999 }))).status).toBe(400);
    expect((await g.create('workOrder', wo(x, { parts: [{ partId: x.svc.id, qty: 1 }] }))).body.error.code).toBe('REFERENCE_NOT_FOUND');
  });
  it('lines are editable only before work starts; starting consumes parts atomically', async () => {
    const g = await shop(); const x = await seed(g, 1); const o = (await g.create('workOrder', wo(x))).body.data; // needs 2, has 1
    const e = await g.patch('workOrder', o.id, { parts: [{ partId: x.part.id, qty: 1 }] }); expect(e.status).toBe(200); expect(e.body.data.data.partsTotal).toBe(8000);
    await g.create('partMovement', { partId: x.part.id, type: 'in', qty: 4 });
    const big = await g.patch('workOrder', o.id, { parts: [{ partId: x.part.id, qty: 9 }], status: 'in_progress' });
    expect(big.status).toBe(409); expect(big.body.error.code).toBe('INSUFFICIENT_STOCK'); expect((await g.get('workOrder', o.id)).body.data.data.status).toBe('open'); expect(await stockOf(g, x.part.id)).toBe(5);
    await walk(g, o.id, 'in_progress'); expect(await stockOf(g, x.part.id)).toBe(4);
    expect((await g.patch('workOrder', o.id, { parts: [{ partId: x.part.id, qty: 2 }] })).body.error.code).toBe('IMMUTABLE');
    expect((await g.patch('workOrder', o.id, { notes: 'checked brakes too' })).status).toBe(200);
  });
  it('cancel after start returns the parts; cannot cancel when ready', async () => {
    const g = await shop(); const x = await seed(g); const o = (await g.create('workOrder', wo(x))).body.data;
    await walk(g, o.id, 'in_progress'); expect(await stockOf(g, x.part.id)).toBe(8); await walk(g, o.id, 'cancelled'); expect(await stockOf(g, x.part.id)).toBe(10);
    expect((await g.patch('workOrder', o.id, { status: 'open' })).body.error.code).toBe('IMMUTABLE');
    const o2 = (await g.create('workOrder', wo(x))).body.data; await walk(g, o2.id, 'in_progress', 'ready');
    expect((await g.patch('workOrder', o2.id, { status: 'cancelled' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await g.patch('workOrder', o2.id, { status: 'diagnosing' })).body.error.code).toBe('INVALID_TRANSITION');
  });
  it('invoice on ready, payments with overpay guard, delivery requires payment and updates odometer', async () => {
    const g = await shop(); const x = await seed(g); const o = (await g.create('workOrder', wo(x))).body.data;
    await walk(g, o.id, 'diagnosing', 'awaiting_parts', 'in_progress', 'ready');
    const inv = (await g.list('invoice')).body.data; expect(inv).toHaveLength(1); expect(inv[0].data.total).toBe(51300); expect(inv[0].data.status).toBe('issued'); expect(inv[0].data.workOrderId).toBe(o.id);
    expect((await g.patch('workOrder', o.id, { status: 'delivered' })).body.error.code).toBe('UNPAID');
    expect((await g.create('payment', { invoiceId: inv[0].id, amount: 51301, method: 'cash' })).body.error.code).toBe('OVERPAYMENT');
    expect((await g.create('payment', { invoiceId: inv[0].id, amount: 20000, method: 'card' })).status).toBe(201);
    expect((await g.get('invoice', inv[0].id)).body.data.data.status).toBe('partially_paid');
    expect((await g.patch('workOrder', o.id, { status: 'delivered' })).body.error.code).toBe('UNPAID');
    await g.create('payment', { invoiceId: inv[0].id, amount: 31300, method: 'cash' });
    expect((await g.get('invoice', inv[0].id)).body.data.data.status).toBe('paid');
    expect((await g.patch('workOrder', o.id, { status: 'delivered', odometerOut: 70000 })).status).toBe(400); // below odometerIn
    expect((await g.patch('workOrder', o.id, { status: 'delivered', odometerOut: 80520 })).status).toBe(200);
    expect((await g.get('vehicle', x.veh.id)).body.data.data.odometer).toBe(80520);
    expect((await g.patch('workOrder', o.id, { notes: 'x' })).body.error.code).toBe('IMMUTABLE');
    expect((await g.create('payment', { invoiceId: inv[0].id, amount: 1, method: 'cash' })).body.error.code).toBe('INVOICE_NOT_PAYABLE');
  });
  it('vehicle maintenance history = work orders filtered by vehicle', async () => {
    const g = await shop(); const x = await seed(g); await g.create('workOrder', wo(x)); await g.create('workOrder', wo(x, { complaint: 'Brakes' }));
    const v2 = (await g.create('vehicle', { customerId: x.cust.id, plate: 'XYZ 9', make: 'Kia', model: 'Rio' })).body.data; await g.create('workOrder', wo(x, { vehicleId: v2.id, parts: [] }));
    expect((await g.list('workOrder', `?vehicleId=${x.veh.id}`)).body.meta.total).toBe(2);
  });
});

describe('public website', () => {
  it('services and spare-parts catalogue; booking form; tracking by plate+phone; isolation', async () => {
    const g = await shop(); const x = await seed(g); const o = await shop('beta'); await seed(o);
    await g.create('service', { name: 'Hidden', price: 1, active: false }); await g.create('sparePart', { sku: 'H-1', name: 'Hidden part', price: 1, active: false });
    const get = (p: string, h = host()) => request(ctx.app).get(`/api/v1/public/catalog/${p}`).set('Host', h);
    expect((await get('service')).body.data.map((s: { name: string }) => s.name)).toEqual(['Oil change']);
    expect((await get('sparePart')).body.data.map((s: { sku: string }) => s.sku)).toEqual(['OF-1']); expect(JSON.stringify((await get('sparePart')).body)).not.toMatch(/cost|supplierId|tenantId/);
    expect((await get('vehicle')).status).toBe(404);
    const b = await request(ctx.app).post('/api/v1/public/forms/booking').set('Host', host()).send({ name: 'Visitor', phone: '٠١٠١١١١٢٢٢٢', plate: 'KKK 111', make: 'Kia', serviceId: x.svc.id, preferredDate: '2030-07-01' });
    expect(b.status).toBe(201); expect((await g.list('bookingRequest')).body.meta.total).toBe(1); expect((await o.list('bookingRequest')).body.meta.total).toBe(0);
    expect((await request(ctx.app).post('/api/v1/public/forms/booking').set('Host', host('beta')).send({ name: 'V', phone: '01011112222', serviceId: x.svc.id })).status).toBe(400);
    const w = (await g.create('workOrder', wo(x))).body.data; await walk(g, w.id, 'in_progress');
    const t = await request(ctx.app).get('/api/v1/public/actions/track?plate=abc1234&phone=01001234567').set('Host', host());
    expect(t.status).toBe(200); expect(t.body.data.status).toBe('in_progress'); expect(JSON.stringify(t.body)).not.toMatch(/tenantId|customerId/);
    expect((await request(ctx.app).get('/api/v1/public/actions/track?plate=abc1234&phone=01000000000').set('Host', host())).status).toBe(404);
    expect((await request(ctx.app).get('/api/v1/public/actions/track?plate=abc1234&phone=01001234567').set('Host', host('beta'))).status).toBe(404);
  });
});

describe('permissions, KPIs, reports, search', () => {
  it('employee works on work orders but cannot see supplier costs ledger edits or delete; KPIs real', async () => {
    const g = await shop(); const x = await seed(g); const e = await employeeAgent(ctx.app, g, 'alpha');
    expect((await e.agent.get('/api/v1/tenant/p/workOrder')).status).toBe(200); expect((await e.agent.get('/api/v1/tenant/p/supplier')).status).toBe(403);
    expect((await e.agent.post('/api/v1/tenant/p/partMovement').set('x-csrf-token', e.csrf).send({ partId: x.part.id, type: 'adjust_up', qty: 1 })).status).toBe(403);
    expect((await e.agent.post('/api/v1/tenant/p/workOrder').set('x-csrf-token', e.csrf).send(wo(x))).status).toBe(201);
    const o = (await g.list('workOrder')).body.data[0]; await walk(g, o.id, 'in_progress', 'ready');
    const inv = (await g.list('invoice')).body.data[0]; await g.create('payment', { invoiceId: inv.id, amount: 10000, method: 'cash' });
    const k = await g.kpis(); expect(k.vehicles).toBe(1); expect(k.openWorkOrders).toBe(1); expect(k.revenueMonth).toBe(10000);
    expect((await g.report('workOrdersByTechnician'))[0]).toEqual({ key: x.tech.id, value: 1 }); expect((await g.report('workOrdersByStatus'))[0]).toEqual({ key: 'ready', value: 1 });
  });
  it('global search: customers, vehicles (plate/VIN), work orders, parts', async () => {
    const g = await shop(); const x = await seed(g); const o = (await g.create('workOrder', wo(x))).body.data;
    const t = async (q: string) => (await g.search(q)).map((s) => s.entityType);
    expect(await t('hassan')).toContain('customer'); expect(await t('abc1234')).toContain('vehicle'); expect(await t('VIN123')).toContain('vehicle'); expect(await t(o.code)).toContain('workOrder'); expect(await t('OF-1')).toContain('sparePart');
  });
});
