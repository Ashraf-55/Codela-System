import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { employeeAgent, setup, tenantClient } from './_helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const host = (slug: string) => `${slug}.codela.test`;

describe('customer payments (InstaPay / Vodafone Cash, manual approval)', () => {
  it('submit -> pending changes nothing -> reject with reason -> resubmit -> approve creates the real payment once', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'cpay', 'learning'); const other = await tenantClient(app, 'cpay2', 'learning');
    const ins = (await o.create('instructor', { name: 'Dr X' })).body.data; const course = (await o.create('course', { title: 'C', instructorId: ins.id, price: 50000 })).body.data;
    await o.create('lesson', { courseId: course.id, title: 'L1', position: 1, durationMin: 5 }); expect((await o.patch('course', course.id, { status: 'published' })).status).toBe(200);
    const st = (await o.create('student', { name: 'Sara', email: 'sara@x.com', phone: '01011112222' })).body.data;
    const enr = (await o.create('enrollment', { studentId: st.id, courseId: course.id })).body.data; expect(enr.code).toBe('EN-0001');
    expect((await o.create('paymentAccount', { method: 'instapay', handle: 'academy@instapay', accountName: 'Academy' })).status).toBe(201);

    const get = (qs: string) => request(app).get(`/api/v1/public/actions/paymentDue?${qs}`).set('Host', host('cpay'));
    const submit = (b: object) => request(app).post('/api/v1/public/actions/submitPayment').set('Host', host('cpay')).send({ code: 'EN-0001', phone: '01011112222', ...b });
    const due = await get('code=EN-0001&phone=01011112222'); expect(due.status).toBe(200); expect(due.body.data.due).toBe(50000); expect(due.body.data.accounts[0].handle).toBe('academy@instapay');
    expect((await get('code=EN-0001&phone=01099999999')).status).toBe(404);                    // wrong phone: indistinguishable from a missing code
    expect((await request(app).get('/api/v1/public/actions/paymentDue?code=EN-0001&phone=01011112222').set('Host', host('cpay2'))).status).toBe(404); // another tenant's site

    expect((await submit({ method: 'vodafone_cash', amount: 1000, reference: 'VC-1111' })).status).toBe(400); // method not configured by the business
    expect((await submit({ method: 'instapay', amount: 60000, reference: 'IP-1111' })).status).toBe(409);       // more than owed
    expect((await submit({ method: 'instapay', amount: 1000 })).status).toBe(400);                               // neither reference nor receipt
    const up = await request(app).put('/api/v1/public/customer-payment/receipt').set('Host', host('cpay')).set('Content-Type', 'application/octet-stream').send(PNG); expect(up.status).toBe(201);
    const bad = await request(app).put('/api/v1/public/customer-payment/receipt').set('Host', host('cpay')).set('Content-Type', 'application/octet-stream').send(Buffer.from('<html><script>alert(1)</script></html>')); expect(bad.status).toBe(415);

    const first = await submit({ method: 'instapay', amount: 20000, reference: 'IP-12345', receiptId: up.body.data.receiptId }); expect(first.status).toBe(201); expect(first.body.data.status).toBe('pending');
    expect((await submit({ method: 'instapay', amount: 1000, reference: ' ip-12345 ' })).status).toBe(409);    // same reference, any spacing/case
    expect((await submit({ method: 'instapay', amount: 1000, receiptId: up.body.data.receiptId })).status).toBe(400); // receipt already used
    expect((await submit({ method: 'instapay', amount: 40000, reference: 'IP-22222' })).status).toBe(409);     // pending requests count against what is still payable
    expect((await o.get('enrollment', enr.id)).body.data.data.paidAmount).toBe(0);                              // a submission never pays anything

    const reqs = (await o.list('paymentRequest')).body.data; expect(reqs).toHaveLength(1); const id = reqs[0].id;
    const rc = await o.agent.get(`/api/v1/tenant/customer-payments/${id}/receipt`); expect(rc.status).toBe(200); expect(rc.headers['content-type']).toBe('image/png');
    expect((await other.agent.get(`/api/v1/tenant/customer-payments/${id}/receipt`)).status).toBe(404);          // other tenants never see it
    expect((await o.agent.get(`/api/v1/tenant/files`)).body.data.some((f: { purpose: string }) => f.purpose === 'receipt')).toBe(false); // not in the generic file list
    const emp = await employeeAgent(app, o, 'cpay'); expect((await emp.agent.patch(`/api/v1/tenant/p/paymentRequest/${id}`).set('x-csrf-token', emp.csrf).send({ status: 'approved' })).status).toBe(403);

    expect((await o.patch('paymentRequest', id, { status: 'rejected' })).status).toBe(400);                      // reason required
    expect((await o.patch('paymentRequest', id, { status: 'rejected', reviewNote: 'Amount does not match' })).status).toBe(200);
    expect((await o.get('enrollment', enr.id)).body.data.data.paidAmount).toBe(0);
    expect((await get('code=EN-0001&phone=01011112222')).body.data.requests[0].reviewNote).toBe('Amount does not match');
    expect((await o.patch('paymentRequest', id, { status: 'approved' })).status).toBe(409);                      // reviewed requests are final

    const again = await submit({ method: 'instapay', amount: 20000, reference: 'IP-12345' }); expect(again.status).toBe(201); // a rejected reference may be reused
    const id2 = (await o.list('paymentRequest')).body.data.find((r: { code: string }) => r.code === again.body.data.code).id;
    expect((await o.patch('paymentRequest', id2, { status: 'approved' })).status).toBe(200);
    const e2 = (await o.get('enrollment', enr.id)).body.data.data; expect(e2.paidAmount).toBe(20000); expect(e2.paymentStatus).toBe('unpaid');
    const done = (await o.get('paymentRequest', id2)).body.data.data; expect(done.status).toBe('approved'); expect(done.reviewedBy).toBeTruthy(); expect(done.paymentRecordId).toBeTruthy();
    expect((await o.list('payment')).body.meta.total).toBe(1);                                                    // exactly one financial record
    expect((await o.patch('paymentRequest', id2, { status: 'rejected', reviewNote: 'x' })).status).toBe(409);
  });

  it('works for e-commerce orders too and for products without customer payments it does not exist', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'cpshop', 'ecommerce'); const f = await tenantClient(app, 'cpreal', 'realestate');
    expect((await o.create('paymentAccount', { method: 'vodafone_cash', handle: '01012345678' })).status).toBe(201);
    expect((await f.create('paymentAccount', { method: 'instapay', handle: 'x@instapay' })).status).not.toBe(201); // real estate has no customer payments
  });
});

describe('customer payments for restaurant and construction (and wiring for automotive / business)', () => {
  const api = (app: Parameters<typeof request>[0], slug: string) => ({
    due: (qs: string) => request(app).get(`/api/v1/public/actions/paymentDue?${qs}`).set('Host', host(slug)),
    pay: (b: object) => request(app).post('/api/v1/public/actions/submitPayment').set('Host', host(slug)).send(b),
  });
  it('restaurant: a delivery order is paid by InstaPay only after staff approve; the order is then paid and invoiced once', async () => {
    const { app } = setup(); const r = await tenantClient(app, 'rpay', 'restaurant'); const cat = (await r.create('menuCategory', { name: 'M' })).body.data; const it = (await r.create('menuItem', { name: 'Burger', categoryId: cat.id, price: 10000 })).body.data;
    const o = (await r.create('order', { type: 'delivery', customerName: 'Ali', customerPhone: '01012345678', address: '1 Street', taxBp: 0, lines: [{ itemId: it.id, qty: 2 }] })).body.data;
    await r.create('paymentAccount', { method: 'instapay', handle: 'resto@instapay' }); const c = api(app, 'rpay');
    const due = await c.due(`code=${o.code}&phone=01012345678`); expect(due.status).toBe(200); expect(due.body.data.due).toBe(20000);
    expect((await c.due(`code=${o.code}&phone=01000000000`)).status).toBe(404);
    expect((await c.pay({ code: o.code, phone: '01012345678', method: 'instapay', amount: 20000, reference: 'RESTO-1001' })).status).toBe(201);
    expect((await r.get('order', o.id)).body.data.data.paymentStatus).toBe('unpaid');
    const id = (await r.list('paymentRequest')).body.data[0].id; expect((await r.patch('paymentRequest', id, { status: 'approved' })).status).toBe(200);
    expect((await r.get('order', o.id)).body.data.data.paymentStatus).toBe('paid'); expect((await r.list('invoice')).body.data).toHaveLength(1);
    expect((await c.pay({ code: o.code, phone: '01012345678', method: 'instapay', amount: 100, reference: 'RESTO-1002' })).status).toBe(409); // nothing left to pay
  });
  it('construction: the client pays an issued invoice in parts; partial approval leaves it partially paid', async () => {
    const { app } = setup(); const b = await tenantClient(app, 'bpay', 'construction'); const cl = (await b.create('client', { name: 'Client', phone: '01022223333' })).body.data;
    const inv = (await b.create('invoice', { clientId: cl.id, lines: [{ desc: 'Painting', qty: 1, unitPrice: 100000 }] })).body.data; await b.patch('invoice', inv.id, { status: 'issued' });
    await b.create('paymentAccount', { method: 'vodafone_cash', handle: '01099998888' }); const c = api(app, 'bpay');
    expect((await c.due(`code=${inv.code}&phone=01022223333`)).body.data.due).toBe(100000);
    expect((await c.pay({ code: inv.code, phone: '01022223333', method: 'vodafone_cash', amount: 40000, reference: 'VC-90001' })).status).toBe(201);
    const id = (await b.list('paymentRequest')).body.data[0].id; expect((await b.patch('paymentRequest', id, { status: 'approved' })).status).toBe(200);
    expect((await b.get('invoice', inv.id)).body.data.data).toMatchObject({ status: 'partially_paid', paidAmount: 40000 });
    expect((await c.due(`code=${inv.code}&phone=01022223333`)).body.data.payable).toBe(60000);
  });
  it('automotive and business expose the same customer payment actions and entities', async () => {
    const { app } = setup(); for (const slug of ['automotive', 'business']) {
      const t = await tenantClient(app, `w${slug}`, slug); const meta = (await t.agent.get('/api/v1/tenant/p-meta')).body.data.entities.map((e: { key: string }) => e.key);
      expect(meta).toEqual(expect.arrayContaining(['paymentAccount', 'paymentRequest'])); expect((await api(app, `w${slug}`).due('code=INV-0001&phone=01000000000')).status).toBe(404);
    }
  });
});

describe('fleet invoices, refunds and the customer portal list', () => {
  const pubApi = (app: Parameters<typeof request>[0], slug: string) => ({ pay: (b: object) => request(app).post('/api/v1/public/actions/submitPayment').set('Host', host(slug)).send(b), due: (qs: string) => request(app).get(`/api/v1/public/actions/paymentDue?${qs}`).set('Host', host(slug)) });
  it('fleet: the customer pays an issued shipping invoice by InstaPay; approval records the real payment; refunding is refused (no refund flow) ', async () => {
    const { app } = setup(); const f = await tenantClient(app, 'fpay', 'fleet'); const p = pubApi(app, 'fpay');
    await f.create('paymentAccount', { method: 'instapay', handle: 'ship@instapay' }); const cust = (await f.create('customer', { name: 'Shop One', phone: '01001234567' })).body.data;
    const inv = (await f.create('invoice', { customerId: cust.id, lines: [{ desc: 'Shipping', qty: 1, unitPrice: 10000 }] })).body.data;
    expect((await p.due(`code=${inv.code}&phone=01001234567`)).body.data.due).toBe(0); // a draft invoice is not payable
    await f.patch('invoice', inv.id, { status: 'issued', lines: inv.data.lines, customerId: cust.id });
    const due = (await p.due(`code=${inv.code}&phone=01001234567`)).body.data; expect(due).toMatchObject({ due: 10000, payable: 10000 }); expect((await p.due(`code=${inv.code}&phone=01009999999`)).status).toBe(404);
    expect((await p.pay({ code: inv.code, phone: '01001234567', method: 'instapay', amount: 4000, reference: 'FLT-1001' })).status).toBe(201);
    const req = ((await f.list('paymentRequest')).body.data as { id: string }[])[0]; expect((await f.patch('paymentRequest', req.id, { status: 'approved' })).status).toBe(200);
    expect((await f.get('invoice', inv.id)).body.data.data).toMatchObject({ paidAmount: 4000, status: 'partially_paid' });
    const r = await f.patch('paymentRequest', req.id, { status: 'refunded', reviewNote: 'returned to the customer' }); expect(r.status).toBe(409); expect(r.body.error.code).toBe('REFUND_NOT_SUPPORTED');
    expect((await f.patch('paymentRequest', req.id, { reviewNote: 'edit after approval' })).status).toBe(409); // approved requests are immutable
  });
  it('booking: an approved payment can be refunded only after the booking is cancelled, through the booking refund rules, with a reason', async () => {
    const { app } = setup(); const s = await tenantClient(app, 'bpay', 'booking'); const p = pubApi(app, 'bpay');
    const branch = (await s.create('branch', { name: 'Maadi', address: '9 Rd', phone: '01001234567' })).body.data; const cat = (await s.create('serviceCategory', { name: 'Hair' })).body.data;
    const cut = (await s.create('service', { name: 'Cut', categoryId: cat.id, durationMin: 60, price: 20000 })).body.data; const nora = (await s.create('staff', { name: 'Nora', branchId: branch.id, skills: [{ serviceId: cut.id }] })).body.data;
    for (let d = 0; d < 7; d++) await s.create('schedule', { staffId: nora.id, weekday: d, from: '09:00', to: '17:00' });
    const cust = (await s.create('customer', { name: 'Dina', phone: '01001112223' })).body.data; await s.create('paymentAccount', { method: 'instapay', handle: 'sal@instapay' });
    const date = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10); const a = (await s.create('appointment', { customerId: cust.id, serviceId: cut.id, staffId: nora.id, branchId: branch.id, date, startTime: '10:00' })).body.data;
    expect((await p.pay({ code: a.code, phone: '01001112223', method: 'instapay', amount: 20000, reference: 'BK-5001' })).status).toBe(201);
    const req = ((await s.list('paymentRequest')).body.data as { id: string }[])[0];
    expect((await s.patch('paymentRequest', req.id, { status: 'refunded', reviewNote: 'x' })).body.error.code).toBe('INVALID_TRANSITION'); // pending cannot be refunded
    await s.patch('paymentRequest', req.id, { status: 'approved' }); expect((await s.get('appointment', a.id)).body.data.data.paidAmount).toBe(20000);
    expect((await s.patch('paymentRequest', req.id, { status: 'refunded', reviewNote: 'Customer cancelled' })).body.error.code).toBe('NOT_REFUNDABLE'); // the booking is still active: nothing changed
    expect((await s.get('paymentRequest', req.id)).body.data.data.status).toBe('approved');
    await s.patch('appointment', a.id, { status: 'cancelled' }); expect((await s.patch('paymentRequest', req.id, { status: 'refunded' })).status).toBe(400); // reason required
    expect((await s.patch('paymentRequest', req.id, { status: 'refunded', reviewNote: 'Customer cancelled' })).status).toBe(200);
    expect((await s.get('appointment', a.id)).body.data.data).toMatchObject({ paymentStatus: 'refunded', refundedAmount: 20000 }); expect(((await s.list('refund')).body.data as unknown[]).length).toBe(1);
    expect((await s.patch('paymentRequest', req.id, { status: 'approved' })).status).toBe(409); // refunded is final
    // the portal shows the customer their own requests (and the refund reason), never another customer's
    const agent = request.agent(app); await agent.post('/api/v1/public/portal/register').set('Host', host('bpay')).send({ name: 'Dina', email: 'dina@x.test', password: 'Str0ng-Pass!1' });
    await s.patch('customer', cust.id, { email: 'dina@x.test' });
    const my = (await agent.get('/api/v1/public/portal/my').set('Host', host('bpay'))).body.data; expect(my.paymentRequests).toHaveLength(1); expect(my.paymentRequests[0]).toMatchObject({ status: 'refunded', amount: 20000, reviewNote: 'Customer cancelled' }); expect(JSON.stringify(my.paymentRequests)).not.toContain('refNorm');
  });
});
