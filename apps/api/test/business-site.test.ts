import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

const PW = 'Staff-Pass-1234!';
async function staff(app: ReturnType<typeof setup>['app'], o: Awaited<ReturnType<typeof tenantClient>>, role: string) {
  const email = `${role}@biz.test`; expect((await o.post('/api/v1/tenant/employees', { name: `${role} user`, email, password: PW, role })).status).toBe(201);
  const a = request.agent(app); const l = await a.post('/api/v1/auth/login').send({ email, password: PW }); expect(l.status).toBe(200); const csrf = l.body.data.csrfToken as string;
  return { get: (e: string) => a.get(`/api/v1/tenant/p/${e}`), create: (e: string, b: object) => a.post(`/api/v1/tenant/p/${e}`).set('x-csrf-token', csrf).send(b) };
}

describe('business: job roles, quotations, attendance and the public company site', () => {
  it('job roles only reach their own modules (API-enforced); only known roles can be assigned', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'biz', 'business');
    const names = (await o.agent.get('/api/v1/tenant/roles')).body.data.map((r: { name: string }) => r.name); expect(names).toEqual(expect.arrayContaining(['manager', 'employee', 'sales', 'warehouse', 'accountant', 'hr']));
    for (const bad of ['owner', 'driver', 'janitor']) expect((await o.post('/api/v1/tenant/employees', { name: 'x y', email: `${bad}@biz.test`, password: PW, role: bad })).status, bad).toBe(400);

    const o2 = await tenantClient(app, 'biz1b', 'business'); // the trial plan allows only a few staff per business, so the roles are spread over two businesses
    const sales = await staff(app, o, 'sales'); const wh = await staff(app, o, 'warehouse'); const acc = await staff(app, o2, 'accountant'); const hr = await staff(app, o2, 'hr');
    const cust = await sales.create('customer', { name: 'Acme', phone: '01011112222' }); expect(cust.status).toBe(201);
    expect((await sales.create('deal', { customerId: cust.body.data.id, title: 'Big', value: 100000 })).status).toBe(201);
    expect((await sales.get('ledgerEntry')).status).toBe(403); expect((await sales.create('product', { name: 'P', sku: 'P1', price: 100 })).status).toBe(403); expect((await sales.get('employee')).status).toBe(403);
    expect((await wh.create('warehouse', { name: 'Main' })).status).toBe(403);                                  // read-only on warehouses
    expect((await wh.get('invoice')).status).toBe(403); expect((await wh.get('employee')).status).toBe(403); expect((await wh.get('deal')).status).toBe(403);
    expect((await acc.get('ledgerEntry')).status).toBe(200); expect((await acc.get('lead')).status).toBe(403); expect((await acc.create('customer', { name: 'No' })).status).toBe(403);
    expect((await hr.create('employee', { name: 'Hana' })).status).toBe(201); expect((await hr.get('invoice')).status).toBe(403); expect((await hr.get('ledgerEntry')).status).toBe(403);
  });

  it('quotations: totals are server-side, frozen once sent, and accepting wins the deal', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'biz2', 'business');
    const c = (await o.create('customer', { name: 'Acme' })).body.data; const d = (await o.create('deal', { customerId: c.id, title: 'Big', value: 100000 })).body.data;
    const q = (await o.create('quotation', { customerId: c.id, dealId: d.id, title: 'Offer', discount: 5000, taxBp: 1400, subtotal: 1, total: 1, lines: [{ description: 'Service', qty: 2, unitPrice: 50000 }, { description: 'Setup', qty: 1, unitPrice: 10000 }] })).body.data;
    expect(q.data).toMatchObject({ subtotal: 110000, tax: 14700, total: 119700, status: 'draft' });        // client totals ignored
    expect((await o.patch('quotation', q.id, { status: 'accepted' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await o.patch('quotation', q.id, { status: 'sent' })).status).toBe(200);
    expect((await o.patch('quotation', q.id, { lines: [{ description: 'x', qty: 1, unitPrice: 1 }] })).body.error.code).toBe('LOCKED');
    expect((await o.patch('quotation', q.id, { status: 'accepted' })).status).toBe(200);
    expect((await o.get('deal', d.id)).body.data.data).toMatchObject({ stage: 'won', weightedValue: 100000 });
    expect((await o.patch('quotation', q.id, { notes: 'x' })).status).toBe(409);                           // accepted is final
  });

  it('attendance: hours computed, one record per employee per day, sane times', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'biz3', 'business'); const e = (await o.create('employee', { name: 'Hana' })).body.data;
    const att = (b: object) => o.create('attendance', { employeeId: e.id, date: '2030-02-03', ...b });
    expect((await att({ checkIn: '17:00', checkOut: '09:00' })).status).toBe(400); expect((await att({ checkOut: '17:00' })).status).toBe(400); expect((await att({ status: 'absent', checkIn: '09:00' })).status).toBe(400);
    const ok = await att({ checkIn: '09:00', checkOut: '17:30' }); expect(ok.status).toBe(201); expect(ok.body.data.data.minutes).toBe(510);
    expect((await att({ checkIn: '09:10' })).body.error.code).toBe('DUPLICATE');
  });

  it('public site: only active content; applications need an open job; kind cannot be forged', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'biz4', 'business'); const h = 'biz4.codela.test'; const get = (e: string) => request(app).get(`/api/v1/public/catalog/${e}`).set('Host', h);
    for (const [e, on, off] of [['service', { name: 'Consulting' }, { name: 'Hidden' }], ['teamMember', { name: 'Ali' }, { name: 'Off' }], ['industry', { name: 'Retail' }, { name: 'Off' }], ['portfolioItem', { title: 'Case A' }, { title: 'Case B' }], ['job', { title: 'Accountant' }, { title: 'Closed role' }]] as const) {
      await o.create(e, on); await o.create(e, { ...off, active: false }); expect((await get(e)).body.data).toHaveLength(1);
    }
    const open = (await get('job')).body.data[0]; const closed = (await o.list('job')).body.data.find((j: { data: { active: boolean } }) => j.data.active === false);
    const post = (k: string, b: object) => request(app).post(`/api/v1/public/forms/${k}`).set('Host', h).send(b);
    expect((await post('jobApplication', { jobId: open.id, name: 'Sara', email: 'sara@x.com', message: 'Hi' })).status).toBe(201);
    expect((await post('jobApplication', { jobId: closed.id, name: 'Sara', email: 'sara@x.com' })).status).toBe(409);
    expect((await post('quoteRequest', { name: 'Omar', phone: '01011112222', message: 'Need a quote' })).status).toBe(201);
    expect((await post('inquiry', { name: 'Omar', phone: '01011112222', message: 'Hello', kind: 'quote' })).status).toBe(201);
    expect((await o.list('inquiry')).body.data.map((r: { data: { kind: string } }) => r.data.kind).sort()).toEqual(['inquiry', 'quote']);
  });
});
