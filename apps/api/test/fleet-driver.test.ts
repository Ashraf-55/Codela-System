import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { employeeAgent, setup, tenantClient } from './_helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('fleet driver portal', () => {
  it('a driver sees and updates only their own shipments; proof and cash follow the delivery rules; admins review proof', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'drv', 'fleet'); const other = await tenantClient(app, 'drv2', 'fleet');
    const branch = (await o.create('branch', { name: 'Hub', address: '1 Rd' })).body.data; const sender = (await o.create('customer', { name: 'Shop', phone: '01001234567' })).body.data;
    await o.create('shippingFeeRule', { name: 'Std', serviceType: 'standard', baseFee: 5000, perKgFee: 1500, includedKg: 1, codFeeBp: 200 });
    const karim = (await o.create('driver', { name: 'Karim', phone: '01111111111', licenseNo: 'L1', licenseExpiry: '2035-01-01' })).body.data; const ali = (await o.create('driver', { name: 'Ali', phone: '01122222222', licenseNo: 'L2', licenseExpiry: '2035-01-01' })).body.data;
    const van = (await o.create('fleetVehicle', { plate: 'drv 1', type: 'van', capacityKg: 500 })).body.data;
    const mk = async (cod: number, who: { id: string }) => { const s = (await o.create('shipment', { senderId: sender.id, branchId: branch.id, recipientName: 'Mona', recipientPhone: '01099998888', recipientAddress: '5 Nile', recipientCity: 'Giza', serviceType: 'standard', weightGrams: 2000, codAmount: cod })).body.data;
      expect((await o.create('assignment', { shipmentId: s.id, driverId: who.id, vehicleId: van.id })).status).toBe(201); return s; };
    const A = await mk(10000, karim); const B = await mk(0, karim); const C = await mk(5000, ali);

    const acct = (b: object) => o.post('/api/v1/tenant/fleet/driver-accounts', b);
    expect((await acct({ driverId: karim.id, email: 'karim@drv.test', password: 'Driver-Pass-1234!' })).status).toBe(201);
    expect((await acct({ driverId: karim.id, email: 'karim2@drv.test', password: 'Driver-Pass-1234!' })).status).toBe(409);   // one login per driver
    expect((await acct({ driverId: ali.id, email: 'karim@drv.test', password: 'Driver-Pass-1234!' })).status).toBe(409);       // e-mail already used
    const emp = await employeeAgent(app, o, 'drv'); expect((await emp.agent.post('/api/v1/tenant/fleet/driver-accounts').set('x-csrf-token', emp.csrf).send({ driverId: ali.id, email: 'a@drv.test', password: 'Driver-Pass-1234!' })).status).toBe(403);

    const d = request.agent(app); const login = await d.post('/api/v1/auth/login').send({ email: 'karim@drv.test', password: 'Driver-Pass-1234!' }); expect(login.status).toBe(200); const csrf = login.body.data.csrfToken as string;
    const post = (u: string, b: object) => d.post(`/api/v1/tenant/driver/${u}`).set('x-csrf-token', csrf).send(b);
    const mine = (await d.get('/api/v1/tenant/driver/shipments')).body.data; expect(mine.map((s: { id: string }) => s.id).sort()).toEqual([A.id, B.id].sort());
    for (const u of ['/api/v1/tenant/p/shipment', '/api/v1/tenant/p/cashCollection', '/api/v1/tenant/p/fleetExpense', '/api/v1/tenant/employees', '/api/v1/tenant/files']) expect((await d.get(u)).status, u).toBe(403); // no admin surface
    expect((await post(`shipments/${C.id}/status`, { status: 'picked_up' })).status).toBe(404);                                // another driver's shipment
    expect((await post(`shipments/${A.id}/status`, { status: 'returned' })).status).toBe(400);                                 // not a driver action
    expect((await post(`shipments/${A.id}/status`, { status: 'delivered', recipientName: 'Mona', collected: 10000 })).status).toBe(409); // cannot skip to delivered
    expect((await post(`shipments/${A.id}/status`, { status: 'picked_up', lat: 200, lng: 31 })).status).toBe(400); expect((await post(`shipments/${A.id}/status`, { status: 'picked_up', lat: 30 })).status).toBe(400); // bad / half a GPS point
    expect((await post(`shipments/${A.id}/status`, { status: 'picked_up', lat: 30.04441, lng: 31.23571 })).status).toBe(200); expect((await post(`shipments/${A.id}/status`, { status: 'out_for_delivery' })).status).toBe(200);
    expect((await o.get('shipment', A.id)).body.data.data.lastLocation).toBe('30.04441,31.23571');
    expect((await post(`shipments/${A.id}/status`, { status: 'delivered', collected: 10000 })).status).toBe(400);                // recipient name required
    expect((await post(`shipments/${A.id}/status`, { status: 'delivered', recipientName: 'Mona', collected: 5000 })).body.error.code).toBe('COD_MISMATCH');
    const put = (id: string, body: Buffer) => d.put(`/api/v1/tenant/driver/shipments/${id}/proof`).set('x-csrf-token', csrf).set('Content-Type', 'application/octet-stream').send(body);
    expect((await put(A.id, PNG)).status).toBe(201); expect((await put(A.id, Buffer.from('<script>alert(1)</script>'))).status).toBe(415); expect((await put(C.id, PNG)).status).toBe(404);
    const done = await post(`shipments/${A.id}/status`, { status: 'delivered', recipientName: 'Mona', note: 'Left with doorman', collected: 10000 }); expect(done.status).toBe(200); expect(done.body.data.status).toBe('delivered'); expect(done.body.data.hasProof).toBe(true);
    const cash = (await o.list('cashCollection')).body.data; expect(cash).toHaveLength(1); expect(cash[0].data).toMatchObject({ amount: 10000, status: 'collected' });
    const sh = (await o.get('shipment', A.id)).body.data.data; expect(sh).toMatchObject({ proofName: 'Mona', proofNote: 'Left with doorman', collectedAmount: 10000 });
    const view = await o.agent.get(`/api/v1/tenant/fleet/shipments/${A.id}/proof`); expect(view.status).toBe(200); expect(view.headers['content-type']).toBe('image/png');
    expect((await other.agent.get(`/api/v1/tenant/fleet/shipments/${A.id}/proof`)).status).toBe(404);
    expect((await o.agent.get('/api/v1/tenant/files')).body.data.some((f: { purpose: string }) => f.purpose === 'proof')).toBe(false);

    await post(`shipments/${B.id}/status`, { status: 'picked_up' }); await post(`shipments/${B.id}/status`, { status: 'out_for_delivery' });
    expect((await post(`shipments/${B.id}/status`, { status: 'failed_attempt' })).status).toBe(400);                            // reason required
    const failed = await post(`shipments/${B.id}/status`, { status: 'failed_attempt', reason: 'Nobody home' }); expect(failed.status).toBe(200); expect(failed.body.data.attempts).toBe(1);
    expect((await d.get('/api/v1/tenant/driver/shipments?scope=history')).body.data.map((s: { id: string }) => s.id)).toEqual([A.id]);
    expect((await d.get('/api/v1/tenant/driver/me')).body.data).toMatchObject({ name: 'Karim', delivered: 1, cashPending: 10000 });
    expect((await o.get('driver', ali.id)).body.data.data.userId).toBeUndefined();
    const nobody = await employeeAgent(app, o, 'drv'); expect((await nobody.agent.get('/api/v1/tenant/driver/shipments')).status).toBe(403); // staff without driver.use
  });
});
