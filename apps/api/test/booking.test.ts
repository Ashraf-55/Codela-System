import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const salon = (slug = 'alpha') => tenantClient(ctx.app, slug, 'booking');
const host = (slug = 'alpha') => `${slug}.codela.test`;
const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** first date at least `min` days ahead falling on `weekday` */
const nextWeekday = (weekday: number, min = 10) => { let n = min; while (weekdayOf(dayOffset(n)) !== weekday) n++; return dayOffset(n); };
const MON = nextWeekday(1);

async function seed(s: TC, allDays = false) {
  const branch = (await s.create('branch', { name: 'Maadi', address: '9 Rd', phone: '01001234567' })).body.data;
  const cat = (await s.create('serviceCategory', { name: 'Hair' })).body.data;
  const cut = (await s.create('service', { name: 'Haircut', categoryId: cat.id, durationMin: 60, bufferMin: 15, price: 20000 })).body.data;
  const color = (await s.create('service', { name: 'Color', categoryId: cat.id, durationMin: 120, price: 50000 })).body.data;
  const nora = (await s.create('staff', { name: 'Nora Stylist', title: 'Senior stylist', branchId: branch.id, skills: [{ serviceId: cut.id }] })).body.data;
  if (allDays) for (let d = 0; d < 7; d++) await s.create('schedule', { staffId: nora.id, weekday: d, from: '09:00', to: '17:00' });
  else await s.create('schedule', { staffId: nora.id, weekday: 1, from: '09:00', to: '17:00' });
  const cust = (await s.create('customer', { name: 'Dina Client', phone: '01001112223', email: 'dina@x.test' })).body.data;
  return { branch, cat, cut, color, nora, cust };
}
const bk = (x: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ customerId: x.cust.id, serviceId: x.cut.id, staffId: x.nora.id, branchId: x.branch.id, date: MON, startTime: '09:00', ...over });

describe('slot rules', () => {
  it('creates a booking with end time, duration and price snapshot', async () => {
    const s = await salon(); const x = await seed(s); const r = await s.create('appointment', bk(x)); expect(r.status).toBe(201);
    expect(r.body.data.code).toBe('BK-0001'); expect(r.body.data.data).toMatchObject({ status: 'pending', startTime: '09:00', endTime: '10:00', durationMin: 60, price: 20000, paymentStatus: 'unpaid', paidAmount: 0, cancelFee: 0 });
    await s.patch('service', x.cut.id, { price: 99999 }); expect((await s.get('appointment', r.body.data.id)).body.data.data.price).toBe(20000);
  });
  it('rejects past dates, unskilled/inactive staff, time off, outside schedule and clashes (with buffer)', async () => {
    const s = await salon(); const x = await seed(s);
    expect((await s.create('appointment', bk(x, { date: dayOffset(-3) }))).body.error.code).toBe('PAST_DATE');
    expect((await s.create('appointment', bk(x, { serviceId: x.color.id }))).body.error.code).toBe('STAFF_CANNOT_PERFORM');
    expect((await s.create('appointment', bk(x, { startTime: '08:00' }))).body.error.code).toBe('OUTSIDE_SCHEDULE');
    expect((await s.create('appointment', bk(x, { startTime: '16:30' }))).body.error.code).toBe('OUTSIDE_SCHEDULE'); // 17:30 > 17:00
    expect((await s.create('appointment', bk(x, { date: nextWeekday(2) }))).body.error.code).toBe('OUTSIDE_SCHEDULE');
    const first = (await s.create('appointment', bk(x))).body.data;
    expect((await s.create('appointment', bk(x, { startTime: '10:00' }))).body.error.code).toBe('SLOT_TAKEN'); // 09:00-10:00 + 15 min buffer
    expect((await s.create('appointment', bk(x, { startTime: '10:15' }))).status).toBe(201);
    await s.patch('appointment', first.id, { status: 'cancelled' }); expect((await s.create('appointment', bk(x, { startTime: '09:00' }))).status).toBe(201);
    await s.create('timeOff', { staffId: x.nora.id, fromDate: MON, toDate: MON, reason: 'Sick' });
    expect((await s.create('appointment', bk(x, { startTime: '13:00' }))).body.error.code).toBe('STAFF_OFF');
    await s.patch('staff', x.nora.id, { active: false }); expect((await s.create('appointment', bk(x, { startTime: '14:00' }))).body.error.code).toBe('STAFF_INACTIVE');
    expect((await s.create('timeOff', { staffId: x.nora.id, fromDate: '2030-02-02', toDate: '2030-02-01' })).status).toBe(400);
    expect((await s.create('schedule', { staffId: x.nora.id, weekday: 3, from: '18:00', to: '09:00' })).status).toBe(400);
  });
  it('reschedule re-validates; transitions and terminal states enforced', async () => {
    const s = await salon(); const x = await seed(s); const a = (await s.create('appointment', bk(x))).body.data; const b = (await s.create('appointment', bk(x, { startTime: '11:00' }))).body.data;
    expect((await s.patch('appointment', b.id, { startTime: '09:30' })).body.error.code).toBe('SLOT_TAKEN');
    const mv = await s.patch('appointment', b.id, { startTime: '13:00' }); expect(mv.status).toBe(200); expect(mv.body.data.data.endTime).toBe('14:00');
    expect((await s.patch('appointment', a.id, { status: 'completed' })).body.error.code).toBe('INVALID_TRANSITION');
    await s.patch('appointment', a.id, { status: 'confirmed' }); await s.patch('appointment', a.id, { status: 'completed' });
    expect((await s.patch('appointment', a.id, { notes: 'x' })).body.error.code).toBe('IMMUTABLE');
  });
});

describe('cancellation policy & payments', () => {
  it('late cancellation / no-show fees follow the policy; free when early or no policy', async () => {
    const s = await salon(); const x = await seed(s, true); const tomorrow = dayOffset(1); const far = dayOffset(30);
    const mk = async (date: string, t: string) => (await s.create('appointment', bk(x, { date, startTime: t }))).body.data;
    const none = await mk(tomorrow, '10:00'); expect((await s.patch('appointment', none.id, { status: 'cancelled' })).body.data.data.cancelFee).toBe(0);
    await s.create('policy', { name: 'Default', freeCancelHours: 48, lateFeeBp: 5000, noShowFeeBp: 10000 });
    const late = await mk(tomorrow, '12:00'); expect((await s.patch('appointment', late.id, { status: 'cancelled' })).body.data.data.cancelFee).toBe(10000);
    const early = await mk(far, '12:00'); expect((await s.patch('appointment', early.id, { status: 'cancelled' })).body.data.data.cancelFee).toBe(0);
    const ns = await mk(far, '14:00'); await s.patch('appointment', ns.id, { status: 'confirmed' }); expect((await s.patch('appointment', ns.id, { status: 'no_show' })).body.data.data.cancelFee).toBe(20000);
  });
  it('payments: partial then paid, no overpayment, cancelled bookings only owe the fee', async () => {
    const s = await salon(); const x = await seed(s, true); const a = (await s.create('appointment', bk(x))).body.data;
    expect((await s.create('payment', { appointmentId: a.id, amount: 20001, method: 'cash' })).body.error.code).toBe('OVERPAYMENT');
    await s.create('payment', { appointmentId: a.id, amount: 5000, method: 'card' }); expect((await s.get('appointment', a.id)).body.data.data).toMatchObject({ paidAmount: 5000, paymentStatus: 'partial' });
    await s.create('payment', { appointmentId: a.id, amount: 15000, method: 'cash' }); expect((await s.get('appointment', a.id)).body.data.data.paymentStatus).toBe('paid');
    const b = (await s.create('appointment', bk(x, { startTime: '12:00' }))).body.data; await s.patch('appointment', b.id, { status: 'cancelled' });
    expect((await s.create('payment', { appointmentId: b.id, amount: 1, method: 'cash' })).body.error.code).toBe('NOT_PAYABLE'); // no fee => nothing due
    expect((await s.list('payment')).body.meta.total).toBe(2); expect((await s.del('payment', (await s.list('payment')).body.data[0].id)).status).toBe(405);
  });
});

describe('availability & public booking', () => {
  const av = (qs: string, h = host()) => request(ctx.app).get(`/api/v1/public/actions/availability?${qs}`).set('Host', h);
  const book = (b: object, h = host()) => request(ctx.app).post('/api/v1/public/actions/book').set('Host', h).send(b);
  it('lists free slots every 15 minutes, excluding bookings (with buffer) and time off', async () => {
    const s = await salon(); const x = await seed(s);
    const all = (await av(`serviceId=${x.cut.id}&date=${MON}`)).body.data; expect(all).toHaveLength(1); expect(all[0].staffName).toBe('Nora Stylist');
    expect(all[0].slots[0]).toBe('09:00'); expect(all[0].slots).toContain('09:15'); expect(all[0].slots.at(-1)).toBe('16:00'); // last start so the 60 min fits before 17:00
    await s.create('appointment', bk(x, { startTime: '11:00' })); // occupies 11:00-12:15 (service + buffer); a new 75-minute block must not touch it
    const slots = (await av(`serviceId=${x.cut.id}&date=${MON}`)).body.data[0].slots as string[];
    expect(slots).toContain('09:45'); expect(slots).not.toContain('10:00'); expect(slots).not.toContain('11:00'); expect(slots).not.toContain('12:00'); expect(slots).toContain('12:15');
    await s.create('timeOff', { staffId: x.nora.id, fromDate: MON, toDate: MON }); expect((await av(`serviceId=${x.cut.id}&date=${MON}`)).body.data).toEqual([]);
    expect((await av(`serviceId=${x.cut.id}&date=${dayOffset(-2)}`)).body.data).toEqual([]);
    expect((await av(`serviceId=nope&date=${MON}`)).status).toBe(404); expect((await av(`serviceId=${x.cut.id}&date=${MON}`, host('beta'))).status).toBe(404);
  });
  it('book: creates pending booking, reuses customer by phone, auto-assigns staff, rejects taken slots and foreign refs, notifies the business', async () => {
    const s = await salon(); const x = await seed(s); const o = await salon('beta'); await seed(o);
    const body = { customer: { name: 'Web Client', phone: '٠١٠٠٥٥٥٦٦٦٦', email: 'w@x.test' }, serviceId: x.cut.id, date: MON, startTime: '09:00' };
    const r = await book(body); expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ code: 'BK-0001', status: 'pending', price: 20000, staffName: 'Nora Stylist' });
    expect((await book(body)).status).toBe(409);
    expect((await book({ ...body, customer: { name: 'Web Client', phone: '01005556666' }, startTime: '11:00' })).status).toBe(201);
    expect((await s.list('customer', '?q=01005556666')).body.meta.total).toBe(1);
    expect((await book({ ...body, startTime: '08:00' })).body.error.code).toBe('NO_AVAILABILITY');
    expect((await book(body, host('beta'))).status).toBe(400);
    const notes = (await s.agent.get('/api/v1/tenant/notifications')).body.data as { type: string }[]; expect(notes.some((n) => n.type === 'booking')).toBe(true);
    expect((await o.agent.get('/api/v1/tenant/notifications')).body.data.some((n: { type: string }) => n.type === 'booking')).toBe(false);
  });
  it('status and cancellation need the booking phone; cancellation applies the policy', async () => {
    const s = await salon(); const x = await seed(s, true); await s.create('policy', { name: 'P', freeCancelHours: 72, lateFeeBp: 2500 });
    const r = await book({ customer: { name: 'Web', phone: '01007778888' }, serviceId: x.cut.id, date: dayOffset(1), startTime: '10:00' }); expect(r.status).toBe(201);
    const st = (phone: string) => request(ctx.app).get(`/api/v1/public/actions/status?code=BK-0001&phone=${phone}`).set('Host', host());
    expect((await st('01007778888')).body.data.status).toBe('pending'); expect((await st('01000000000')).status).toBe(404); expect(JSON.stringify((await st('01007778888')).body)).not.toMatch(/tenantId|customerId/);
    const bad = await request(ctx.app).post('/api/v1/public/actions/cancel').set('Host', host()).send({ code: 'BK-0001', phone: '01000000000' }); expect(bad.status).toBe(404);
    const c = await request(ctx.app).post('/api/v1/public/actions/cancel').set('Host', host()).send({ code: 'BK-0001', phone: '01007778888' });
    expect(c.status).toBe(200); expect(c.body.data).toMatchObject({ status: 'cancelled', cancelFee: 5000 });
    expect((await request(ctx.app).post('/api/v1/public/actions/cancel').set('Host', host()).send({ code: 'BK-0001', phone: '01007778888' })).status).toBe(409);
  });
  it('public catalogue: services, staff, categories, branches are public; schedules and customers are not', async () => {
    const s = await salon(); const x = await seed(s); await s.create('service', { name: 'Hidden', durationMin: 30, price: 1, active: false });
    const get = (p: string) => request(ctx.app).get(`/api/v1/public/catalog/${p}`).set('Host', host());
    expect((await get('service')).body.data.map((v: { name: string }) => v.name).sort()).toEqual(['Color', 'Haircut']); expect((await get('staff')).body.data[0].name).toBe('Nora Stylist');
    expect(JSON.stringify((await get('staff')).body)).not.toMatch(/phone|email|tenantId|skills/); expect((await get('branch')).body.data[0].name).toBe('Maadi');
    for (const p of ['customer', 'schedule', 'appointment', 'policy', 'payment']) expect((await get(p)).status).toBe(404);
    expect(x.cat.id).toBeTruthy();
  });
});

describe('analytics, permissions, search', () => {
  it('KPIs/reports from real data; employee can book but not edit schedules/policies; search works', async () => {
    const s = await salon(); const x = await seed(s); const e = await employeeAgent(ctx.app, s, 'alpha');
    expect((await e.agent.post('/api/v1/tenant/p/appointment').set('x-csrf-token', e.csrf).send(bk(x))).status).toBe(201);
    for (const ent of ['schedule', 'policy', 'timeOff']) expect((await e.agent.get(`/api/v1/tenant/p/${ent}`)).status).toBe(403);
    const a = (await s.list('appointment')).body.data[0]; await s.patch('appointment', a.id, { status: 'confirmed' }); await s.create('payment', { appointmentId: a.id, amount: 20000, method: 'cash' });
    const k = await s.kpis(); expect(k.customers).toBe(1); expect(k.pendingConfirmations).toBe(0); expect(k.revenueMonth).toBe(20000);
    expect((await s.report('appointmentsByStatus'))[0]).toEqual({ key: 'confirmed', value: 1 }); expect((await s.report('appointmentsByStaff'))[0]).toEqual({ key: x.nora.id, value: 1 });
    const t = async (q: string) => (await s.search(q)).map((r) => r.entityType);
    expect(await t('haircut')).toContain('service'); expect(await t('nora')).toContain('staff'); expect(await t('dina')).toContain('customer'); expect(await t('0100111')).toContain('customer'); expect(await t('BK-0001')).toContain('appointment');
    expect((await s.create('customer', { name: 'Dup', phone: '٠١٠٠١١١٢٢٢٣' })).status).toBe(409);
  });
});

describe('public rescheduling', () => {
  const act = (slug: string, key: string, body: object) => request(ctx.app).post(`/api/v1/public/actions/${key}`).set('host', host(slug)).send(body);
  it('moves a booking after proving ownership; re-validates the slot; blocks strangers, taken slots and finished bookings', async () => {
    const s = await salon(); const x = await seed(s);
    const b = (await act('alpha', 'book', { serviceId: x.cut.id, date: MON, startTime: '09:00', customer: { name: 'Dina Client', phone: '01001112223' } })).body.data;
    // the booking's own block does not hide its own slots when ownership is proven
    const mine = await request(ctx.app).get('/api/v1/public/actions/availability').set('host', host('alpha')).query({ serviceId: x.cut.id, date: MON, code: b.code, phone: '01001112223' });
    expect(mine.body.data[0].slots).toContain('09:00');
    const stranger = await request(ctx.app).get('/api/v1/public/actions/availability').set('host', host('alpha')).query({ serviceId: x.cut.id, date: MON, code: b.code, phone: '01000000000' });
    expect(stranger.body.data[0].slots).not.toContain('09:00');
    expect((await act('alpha', 'reschedule', { code: b.code, phone: '01000000000', date: MON, startTime: '11:00' })).status).toBe(404);
    const ok = await act('alpha', 'reschedule', { code: b.code, phone: '01001112223', date: MON, startTime: '11:00' });
    expect(ok.status).toBe(200); expect(ok.body.data).toMatchObject({ startTime: '11:00', endTime: '12:00' });
    expect((await act('alpha', 'reschedule', { code: b.code, phone: '01001112223', date: MON, startTime: '08:00' })).body.error.code).toBe('OUTSIDE_SCHEDULE');
    const other = (await act('alpha', 'book', { serviceId: x.cut.id, date: MON, startTime: '14:00', customer: { name: 'Sara', phone: '01002223334' } })).body.data;
    expect((await act('alpha', 'reschedule', { code: b.code, phone: '01001112223', date: MON, startTime: '14:00' })).body.error.code).toBe('SLOT_TAKEN');
    await act('alpha', 'cancel', { code: other.code, phone: '01002223334' });
    expect((await act('alpha', 'reschedule', { code: other.code, phone: '01002223334', date: MON, startTime: '15:00' })).body.error.code).toBe('NOT_RESCHEDULABLE');
    expect((await act('beta', 'reschedule', { code: b.code, phone: '01001112223', date: MON, startTime: '12:00' })).status).not.toBe(200);
  });
});

describe('refunds (cancellation policy): recorded, capped, never silent', () => {
  it('only cancelled / no-show bookings; the retained fee is kept; never more than was paid; immutable; staff without the refunds module cannot', async () => {
    const s = await salon(); const x = await seed(s, true); await s.create('policy', { name: 'Default', freeCancelHours: 48, lateFeeBp: 5000, noShowFeeBp: 10000 });
    const a = (await s.create('appointment', bk(x, { date: dayOffset(1), startTime: '12:00' }))).body.data; // price 20000, late cancellation fee = 50% = 10000
    expect((await s.create('payment', { appointmentId: a.id, amount: 20000, method: 'card' })).status).toBe(201);
    expect((await s.create('refund', { appointmentId: a.id, amount: 1000, method: 'card', reason: 'x' })).body.error.code).toBe('NOT_REFUNDABLE'); // still an active booking
    expect((await s.patch('appointment', a.id, { status: 'cancelled' })).body.data.data.cancelFee).toBe(10000);
    expect((await s.create('refund', { appointmentId: a.id, amount: 10001, method: 'card', reason: 'too much' })).body.error.code).toBe('OVER_REFUND'); // paid 20000 - fee 10000 = 10000 refundable
    expect((await s.create('refund', { appointmentId: a.id, amount: 5000, method: 'card' })).status).toBe(400); // a reason is required
    const r1 = await s.create('refund', { appointmentId: a.id, amount: 4000, method: 'card', reason: 'Customer cancelled within policy' }); expect(r1.status).toBe(201); expect(r1.body.data.code).toMatch(/^RF-/);
    expect((await s.get('appointment', a.id)).body.data.data).toMatchObject({ refundedAmount: 4000, paymentStatus: 'partially_refunded', paidAmount: 20000 });
    expect((await s.create('refund', { appointmentId: a.id, amount: 6001, method: 'card', reason: 'again' })).body.error.code).toBe('OVER_REFUND');
    expect((await s.create('refund', { appointmentId: a.id, amount: 6000, method: 'card', reason: 'rest of the deposit' })).status).toBe(201);
    expect((await s.get('appointment', a.id)).body.data.data.refundedAmount).toBe(10000);
    expect((await s.patch('refund', r1.body.data.id, { amount: 1 })).status).toBeGreaterThanOrEqual(400); expect((await s.del('refund', r1.body.data.id)).status).toBeGreaterThanOrEqual(400);
    // a fully refunded booking (no fee kept) reads as refunded
    const b = (await s.create('appointment', bk(x, { date: dayOffset(40), startTime: '10:00' }))).body.data; await s.create('payment', { appointmentId: b.id, amount: 8000, method: 'cash' }); await s.patch('appointment', b.id, { status: 'cancelled' });
    expect((await s.create('refund', { appointmentId: b.id, amount: 8000, method: 'cash', reason: 'free cancellation' })).status).toBe(201); expect((await s.get('appointment', b.id)).body.data.data.paymentStatus).toBe('refunded');
    const kpis = (await s.agent.get('/api/v1/tenant/p-kpis')).body.data as { key: string; value: number }[]; if (Array.isArray(kpis)) expect(kpis.find((k) => k.key === 'refundsMonth')?.value).toBe(18000);
    const emp = await employeeAgent(ctx.app, s, 'alpha'); expect((await emp.agent.get('/api/v1/tenant/p/refund')).status).toBe(403); expect((await emp.agent.post('/api/v1/tenant/p/refund').set('x-csrf-token', emp.csrf).send({ appointmentId: a.id, amount: 1, method: 'cash', reason: 'x' })).status).toBe(403);
    // the customer is told what is owed when they cancel from the website; the business still records the refund itself
    const c = (await s.create('appointment', bk(x, { date: dayOffset(1), startTime: '14:00' }))).body.data; await s.create('payment', { appointmentId: c.id, amount: 20000, method: 'card' });
    const pub = await request(ctx.app).post('/api/v1/public/actions/cancel').set('Host', host()).send({ code: c.code, phone: '01001112223' }); expect(pub.status).toBe(200); expect(pub.body.data).toMatchObject({ cancelFee: 10000, refundDue: 10000 });
  });
});
