import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const fleet = (slug = 'alpha') => tenantClient(ctx.app, slug, 'fleet');
const host = (slug = 'alpha') => `${slug}.codela.test`;

async function seed(f: TC) {
  const branch = (await f.create('branch', { name: 'Cairo Hub', address: '1 Ring Rd' })).body.data;
  const sender = (await f.create('customer', { name: 'Shop Sender', phone: '01001234567' })).body.data;
  await f.create('shippingFeeRule', { name: 'Standard', serviceType: 'standard', baseFee: 5000, perKgFee: 1500, includedKg: 1, codFeeBp: 200 });
  await f.create('shippingFeeRule', { name: 'Express', serviceType: 'express', baseFee: 9000, perKgFee: 2500, includedKg: 1, codFeeBp: 200 });
  const driver = (await f.create('driver', { name: 'Karim Driver', phone: '01111111111', licenseNo: 'L-1', licenseExpiry: '2035-01-01', branchId: branch.id })).body.data;
  const van = (await f.create('fleetVehicle', { plate: 'del 123', type: 'van', capacityKg: 500 })).body.data;
  return { branch, sender, driver, van };
}
const ship = (x: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ senderId: x.sender.id, branchId: x.branch.id, recipientName: 'Mona Recipient', recipientPhone: '01099998888', recipientAddress: '5 Nile St', recipientCity: 'Giza',
  serviceType: 'standard', weightGrams: 2500, codAmount: 10000, description: 'Books', ...over });
const events = async (f: TC, id: string) => (await f.list('trackingEvent', `?shipmentId=${id}&sort=seq&dir=asc`)).body.data.map((e: { data: { status: string } }) => e.data.status);
const assign = (f: TC, shipmentId: string, x: Awaited<ReturnType<typeof seed>>, over: object = {}) => f.create('assignment', { shipmentId, driverId: x.driver.id, vehicleId: x.van.id, ...over });
const walk = async (f: TC, id: string, ...st: string[]) => { for (const s of st) expect((await f.patch('shipment', id, { status: s })).status, s).toBe(200); };

describe('rates & shipments', () => {
  it('prices from the rate rule with integer math; unknown service has no rate; tracking code issued', async () => {
    const f = await fleet(); const x = await seed(f);
    const r = await f.create('shipment', ship(x, { fee: 1 })); expect(r.status).toBe(201); const d = r.body.data.data;
    expect(r.body.data.code).toBe('SH-0001'); expect(d).toMatchObject({ fee: 8000, codFee: 200, status: 'created', attempts: 0 }); // 3 kg: 5000 + 2*1500
    expect((await f.create('shipment', ship(x, { serviceType: 'express', weightGrams: 900, codAmount: 0 }))).body.data.data).toMatchObject({ fee: 9000, codFee: 0 });
    expect((await f.create('shipment', ship(x, { serviceType: 'same_day' }))).body.error.code).toBe('NO_RATE');
    expect((await f.create('shipment', ship(x, { weightGrams: 0 }))).status).toBe(400);
    expect((await f.create('shippingFeeRule', { name: 'Dup', serviceType: 'standard', baseFee: 1, perKgFee: 1, includedKg: 1 })).body.error.code).toBe('RATE_EXISTS');
    expect(await events(f, r.body.data.id)).toEqual(['created']);
  });
});

describe('dispatch', () => {
  it('driver licence, vehicle capacity, one active assignment, reassignment, terminal shipments', async () => {
    const f = await fleet(); const x = await seed(f);
    const s1 = (await f.create('shipment', ship(x, { weightGrams: 300000 }))).body.data; const s2 = (await f.create('shipment', ship(x, { weightGrams: 300000 }))).body.data;
    const old = (await f.create('driver', { name: 'Old Licence', licenseExpiry: '2020-01-01' })).body.data;
    expect((await assign(f, s1.id, x, { driverId: old.id })).body.error.code).toBe('LICENSE_EXPIRED');
    const a1 = await assign(f, s1.id, x); expect(a1.status).toBe(201); expect((await f.get('shipment', s1.id)).body.data.data.driverId).toBe(x.driver.id);
    expect((await assign(f, s1.id, x)).body.error.code).toBe('ALREADY_ASSIGNED');
    expect((await assign(f, s2.id, x)).body.error.code).toBe('OVER_CAPACITY'); // 600 kg on a 500 kg van
    expect((await f.patch('assignment', a1.body.data.id, { status: 'cancelled' })).status).toBe(200); expect((await f.get('shipment', s1.id)).body.data.data.driverId ?? null).toBeNull();
    expect((await assign(f, s2.id, x)).status).toBe(201); expect((await assign(f, s1.id, x)).body.error.code).toBe('OVER_CAPACITY');
    await f.patch('fleetVehicle', x.van.id, { status: 'maintenance' }); const s3 = (await f.create('shipment', ship(x))).body.data;
    expect((await assign(f, s3.id, x)).body.error.code).toBe('VEHICLE_UNAVAILABLE');
    await f.patch('shipment', s3.id, { status: 'cancelled' }); expect((await assign(f, s3.id, x, { vehicleId: undefined })).body.error.code).toBe('NOT_DISPATCHABLE');
  });
});

describe('delivery lifecycle & cash', () => {
  it('records every status change; out-for-delivery needs dispatch; delivery books COD collection; settlement is final', async () => {
    const f = await fleet(); const x = await seed(f); const s = (await f.create('shipment', ship(x))).body.data;
    expect((await f.patch('shipment', s.id, { status: 'delivered' })).body.error.code).toBe('INVALID_TRANSITION');
    await walk(f, s.id, 'picked_up', 'at_hub'); expect((await f.patch('shipment', s.id, { status: 'out_for_delivery' })).body.error.code).toBe('NOT_DISPATCHED');
    await assign(f, s.id, x); await walk(f, s.id, 'out_for_delivery', 'delivered');
    expect(await events(f, s.id)).toEqual(['created', 'picked_up', 'at_hub', 'assigned', 'out_for_delivery', 'delivered']);
  });
  it('COD collection and settlement', async () => {
    const f = await fleet(); const x = await seed(f); const s = (await f.create('shipment', ship(x))).body.data; const s0 = (await f.create('shipment', ship(x, { codAmount: 0 }))).body.data;
    await assign(f, s.id, x); await walk(f, s.id, 'picked_up', 'out_for_delivery', 'delivered');
    const col = (await f.list('cashCollection')).body.data; expect(col).toHaveLength(1); expect(col[0].data).toMatchObject({ amount: 10000, status: 'collected', shipmentId: s.id, driverId: x.driver.id });
    expect((await f.get('shipment', s.id)).body.data.data.deliveredAt).toBeTruthy(); expect((await f.patch('shipment', s.id, { recipientName: 'x' })).body.error.code).toBe('IMMUTABLE');
    expect((await f.kpis()).unsettledCash).toBe(10000); expect((await f.report('unsettledByDriver'))[0]).toEqual({ key: x.driver.id, value: 10000 });
    const st = await f.patch('cashCollection', col[0].id, { status: 'settled' }); expect(st.status).toBe(200); expect(st.body.data.data.settledAt).toBeTruthy();
    expect((await f.patch('cashCollection', col[0].id, { status: 'collected' })).body.error.code).toBe('IMMUTABLE'); expect((await f.create('cashCollection', { shipmentId: s.id, amount: 1 })).status).toBe(405);
    expect((await f.kpis()).unsettledCash).toBe(0);
    await assign(f, s0.id, x, { vehicleId: undefined }); await walk(f, s0.id, 'picked_up', 'out_for_delivery', 'delivered'); expect((await f.list('cashCollection')).body.meta.total).toBe(1);
  });
  it('failed attempts increment; the third failure returns the shipment; cancel only before transit', async () => {
    const f = await fleet(); const x = await seed(f); const s = (await f.create('shipment', ship(x))).body.data; await assign(f, s.id, x); await walk(f, s.id, 'picked_up');
    for (let i = 1; i <= 2; i++) { await walk(f, s.id, 'out_for_delivery', 'failed_attempt'); expect((await f.get('shipment', s.id)).body.data.data.attempts).toBe(i); }
    await walk(f, s.id, 'out_for_delivery'); await f.patch('shipment', s.id, { status: 'failed_attempt', failureReason: 'No answer' });
    const fin = (await f.get('shipment', s.id)).body.data.data; expect(fin.attempts).toBe(3); expect(fin.status).toBe('returned');
    expect((await f.patch('shipment', s.id, { status: 'out_for_delivery' })).body.error.code).toBe('IMMUTABLE');
    const c = (await f.create('shipment', ship(x))).body.data; await walk(f, c.id, 'picked_up', 'at_hub'); expect((await f.patch('shipment', c.id, { status: 'cancelled' })).body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('expenses, KPIs, reports', () => {
  it('fleet expenses ledger; KPIs and reports from real data', async () => {
    const f = await fleet(); const x = await seed(f);
    expect((await f.create('fleetExpense', { vehicleId: x.van.id, driverId: x.driver.id, type: 'fuel', amount: 45000, date: new Date().toISOString().slice(0, 10) })).status).toBe(201);
    expect((await f.create('fleetExpense', { vehicleId: x.van.id, type: 'fuel', amount: 1.5, date: '2030-01-01' })).status).toBe(400);
    expect((await f.del('fleetExpense', (await f.list('fleetExpense')).body.data[0].id)).status).toBe(405); expect((await f.del('fleetVehicle', x.van.id)).body.error.code).toBe('IN_USE');
    const s = (await f.create('shipment', ship(x))).body.data; await assign(f, s.id, x); await walk(f, s.id, 'picked_up');
    const k = await f.kpis(); expect(k.shipmentsToday).toBe(1); expect(k.inTransit).toBe(1); expect(k.activeDrivers).toBe(1);
    expect((await f.report('shipmentsByStatus'))[0]).toEqual({ key: 'picked_up', value: 1 }); expect((await f.report('expensesByType'))[0]).toEqual({ key: 'fuel', value: 45000 });
  });
});

describe('public tracking portal', () => {
  const get = (p: string, h = host()) => request(ctx.app).get(`/api/v1/public/${p}`).set('Host', h);
  it('timeline by tracking number + sender or recipient phone; no internal data; isolation', async () => {
    const f = await fleet(); const x = await seed(f); const o = await fleet('beta'); await seed(o);
    const s = (await f.create('shipment', ship(x))).body.data; await assign(f, s.id, x); await walk(f, s.id, 'picked_up');
    for (const phone of ['01099998888', '٠١٠٠١٢٣٤٥٦٧']) {
      const t = await get(`actions/track?code=SH-0001&phone=${phone}`); expect(t.status).toBe(200);
      expect(t.body.data).toMatchObject({ code: 'SH-0001', status: 'picked_up', serviceType: 'standard' }); expect(t.body.data.timeline.map((e: { status: string }) => e.status)).toContain('picked_up');
      expect(JSON.stringify(t.body)).not.toMatch(/driver|vehicleId|tenantId|senderId|codFee|01111111111/i);
    }
    expect((await get('actions/track?code=SH-0001&phone=01000000000')).status).toBe(404); expect((await get('actions/track?code=SH-0001&phone=01099998888', host('beta'))).status).toBe(404);
    const q = await request(ctx.app).post('/api/v1/public/actions/quote').set('Host', host()).send({ serviceType: 'standard', weightGrams: 2500, codAmount: 10000 });
    expect(q.status).toBe(200); expect(q.body.data).toMatchObject({ fee: 8000, codFee: 200, total: 8200 }); expect((await request(ctx.app).post('/api/v1/public/actions/quote').set('Host', host()).send({ serviceType: 'same_day', weightGrams: 1 })).status).toBe(409);
  });
  it('shipping request and inquiry forms; catalogue of services; private entities hidden', async () => {
    const f = await fleet(); await seed(f); const o = await fleet('beta');
    const r = await request(ctx.app).post('/api/v1/public/forms/shippingRequest').set('Host', host()).send({ name: 'Visitor', phone: '٠١٠٢٢٢٢٣٣٣٣', pickupAddress: 'A', dropAddress: 'B', weightGrams: 1000, serviceType: 'standard' });
    expect(r.status).toBe(201); expect((await f.list('shippingRequest')).body.meta.total).toBe(1); expect((await o.list('shippingRequest')).body.meta.total).toBe(0);
    expect((await request(ctx.app).post('/api/v1/public/forms/inquiry').set('Host', host()).send({ name: 'V', phone: '01011112222', message: 'hello' })).status).toBe(201);
    expect((await get('catalog/shippingFeeRule')).body.data.map((s: { serviceType: string }) => s.serviceType).sort()).toEqual(['express', 'standard']);
    expect(JSON.stringify((await get('catalog/shippingFeeRule')).body)).not.toMatch(/codFeeBp|tenantId/); expect((await get('catalog/branch')).body.data[0].name).toBe('Cairo Hub');
    for (const p of ['shipment', 'driver', 'cashCollection', 'fleetExpense']) expect((await get(`catalog/${p}`)).status).toBe(404);
  });
});

describe('permissions & search', () => {
  it('dispatcher role can dispatch but not settle cash or see expenses; search covers shipments, drivers, vehicles', async () => {
    const f = await fleet(); const x = await seed(f); const e = await employeeAgent(ctx.app, f, 'alpha');
    const s = (await f.create('shipment', ship(x))).body.data;
    expect((await e.agent.post('/api/v1/tenant/p/assignment').set('x-csrf-token', e.csrf).send({ shipmentId: s.id, driverId: x.driver.id, vehicleId: x.van.id })).status).toBe(201);
    expect((await e.agent.get('/api/v1/tenant/p/fleetExpense')).status).toBe(403); expect((await e.agent.get('/api/v1/tenant/p/shipment')).status).toBe(200);
    await f.patch('shipment', s.id, { status: 'picked_up' }); await f.patch('shipment', s.id, { status: 'out_for_delivery' }); await f.patch('shipment', s.id, { status: 'delivered' });
    const col = (await f.list('cashCollection')).body.data[0]; expect((await e.agent.get('/api/v1/tenant/p/cashCollection')).status).toBe(200);
    expect((await e.agent.patch(`/api/v1/tenant/p/cashCollection/${col.id}`).set('x-csrf-token', e.csrf).send({ status: 'settled' })).status).toBe(403);
    const t = async (q: string) => (await f.search(q)).map((r) => r.entityType);
    expect(await t('SH-0001')).toContain('shipment'); expect(await t('karim')).toContain('driver'); expect(await t('del123')).toContain('fleetVehicle'); expect(await t('mona')).toContain('shipment'); expect(await t('0109999')).toContain('shipment');
  });
});
