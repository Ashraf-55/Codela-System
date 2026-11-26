import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test' }); });
const today = new Date().toISOString().slice(0, 10);

async function clinic(slug = 'alpha', product = 'medical') {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register-business').send({ businessName: `Clinic ${slug}`, slug, productSlug: product, name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });
  expect(r.status).toBe(201);
  const csrf = r.body.data.csrfToken as string;
  const call = (m: 'post' | 'patch' | 'delete' | 'put', u: string, b?: object) => agent[m](u).set('x-csrf-token', csrf).send(b ?? {});
  const base = '/api/v1/tenant/p';
  return { agent, csrf, tenantId: r.body.data.tenant.id as string,
    list: (e: string, qs = '') => agent.get(`${base}/${e}${qs}`),
    get: (e: string, id: string) => agent.get(`${base}/${e}/${id}`),
    create: (e: string, b: object) => call('post', `${base}/${e}`, b),
    patch: (e: string, id: string, b: object) => call('patch', `${base}/${e}/${id}`, b),
    del: (e: string, id: string) => call('delete', `${base}/${e}/${id}`),
    post: (u: string, b?: object) => call('post', u, b) };
}
type C = Awaited<ReturnType<typeof clinic>>;
async function seed(c: C) {
  const spec = (await c.create('specialty', { name: 'Cardiology' })).body.data;
  const doc = (await c.create('doctor', { name: 'Dr. Hany', specialtyId: spec.id, consultationFee: 30000, phone: '01001234567' })).body.data;
  const pat = (await c.create('patient', { name: 'Ahmed Ali', phone: '01112223334', gender: 'male', birthDate: '1990-05-01' })).body.data;
  return { spec, doc, pat };
}
const appt = (s: { doc: { id: string }; pat: { id: string } }, over: object = {}) => ({ patientId: s.pat.id, doctorId: s.doc.id, date: '2030-01-07', startTime: '10:00', durationMin: 30, ...over });

describe('meta & CRUD', () => {
  it('exposes only this product\'s entities', async () => {
    const c = await clinic(); const meta = await c.agent.get('/api/v1/tenant/p-meta');
    expect(meta.body.data.entities.map((e: { key: string }) => e.key)).toEqual(expect.arrayContaining(['patient', 'doctor', 'appointment', 'invoice', 'payment', 'medicalRecord']));
    expect((await c.list('menuItem')).status).toBe(404);
  });
  it('creates patients with auto codes, validates, filters, searches, sorts, paginates', async () => {
    const c = await clinic();
    const a = await c.create('patient', { name: 'Ahmed Ali', phone: '٠١٠٠١٢٣٤٥٦٧', gender: 'male' });
    expect(a.status).toBe(201); expect(a.body.data.code).toBe('PT-0001'); expect(a.body.data.data.phone).toBe('01001234567');
    expect((await c.create('patient', { name: 'Mona Said', gender: 'female' })).body.data.code).toBe('PT-0002');
    expect((await c.create('patient', { gender: 'male' })).status).toBe(400);
    expect((await c.create('patient', { name: 'X', gender: 'robot' })).body.data?.error ?? (await c.create('patient', { name: 'X', gender: 'robot' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await c.list('patient', '?gender=female')).body.meta.total).toBe(1);
    expect((await c.list('patient', '?q=mona')).body.data[0].data.name).toBe('Mona Said');
    expect((await c.list('patient', '?q=pt-0001')).body.data).toHaveLength(1);
    expect((await c.list('patient', '?q=0100123')).body.data).toHaveLength(1);
    expect((await c.list('patient', '?sort=name&dir=desc')).body.data[0].data.name).toBe('Mona Said');
    const p = await c.list('patient', '?pageSize=1&page=2'); expect(p.body.data).toHaveLength(1); expect(p.body.meta.total).toBe(2);
    expect((await c.list('patient', '?sort=notAField')).status).toBe(400);
    expect((await c.list('patient', '?q=%25')).body.data).toEqual([]);
  });
  it('update validates, strips mass-assignment, returns 404 for missing', async () => {
    const c = await clinic(); const id = (await c.create('patient', { name: 'A B' })).body.data.id;
    const u = await c.patch('patient', id, { name: 'A C', tenantId: 'evil', code: 'HACK' });
    expect(u.status).toBe(200); expect(u.body.data.data.name).toBe('A C'); expect(u.body.data.code).toBe('PT-0001'); expect(u.body.data.tenantId).not.toBe('evil');
    expect((await c.patch('patient', id, { gender: 'x' })).status).toBe(400);
    expect((await c.patch('patient', 'nope', { name: 'Z Z' })).status).toBe(404);
  });
  it('tenant isolation: list/get/patch/delete and cross-tenant references', async () => {
    const a = await clinic('alpha'); const b = await clinic('beta');
    const pa = (await a.create('patient', { name: 'Secret Patient' })).body.data;
    expect((await b.list('patient')).body.data).toEqual([]);
    expect((await b.get('patient', pa.id)).status).toBe(404);
    expect((await b.patch('patient', pa.id, { name: 'Hacked' })).status).toBe(404);
    expect((await b.del('patient', pa.id)).status).toBe(404);
    const sb = await seed(b);
    const r = await b.create('appointment', appt({ doc: sb.doc, pat: { id: pa.id } }));
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('REFERENCE_NOT_FOUND');
  });
  it('unique keys: specialty names unique per tenant, not globally', async () => {
    const a = await clinic('alpha'); const b = await clinic('beta');
    expect((await a.create('specialty', { name: 'Dental' })).status).toBe(201);
    expect((await a.create('specialty', { name: 'dental' })).status).toBe(409);
    expect((await b.create('specialty', { name: 'Dental' })).status).toBe(201);
  });
  it('cannot delete records that are referenced (restrict)', async () => {
    const c = await clinic(); const s = await seed(c);
    await c.create('appointment', appt(s));
    const d = await c.del('patient', s.pat.id); expect(d.status).toBe(409); expect(d.body.error.code).toBe('IN_USE');
    expect((await c.del('specialty', s.spec.id)).status).toBe(409);
  });
});

describe('appointments workflow', () => {
  it('prevents double booking, allows adjacent, cancelled frees the slot, other doctor ok', async () => {
    const c = await clinic(); const s = await seed(c);
    expect((await c.create('appointment', appt(s))).status).toBe(201);
    const clash = await c.create('appointment', appt(s, { startTime: '10:15' }));
    expect(clash.status).toBe(409); expect(clash.body.error.code).toBe('SLOT_TAKEN');
    expect((await c.create('appointment', appt(s, { startTime: '10:30' }))).status).toBe(201);
    const doc2 = (await c.create('doctor', { name: 'Dr. Two', specialtyId: s.spec.id })).body.data;
    expect((await c.create('appointment', appt(s, { doctorId: doc2.id }))).status).toBe(201);
    const first = (await c.list('appointment', '?sort=startTime')).body.data.find((x: { data: { startTime: string; doctorId: string } }) => x.data.startTime === '10:00' && x.data.doctorId === s.doc.id);
    await c.patch('appointment', first.id, { status: 'cancelled' });
    expect((await c.create('appointment', appt(s, { startTime: '10:00' }))).status).toBe(201);
  });
  it('respects doctor weekly schedule when defined', async () => {
    const c = await clinic(); const s = await seed(c); // 2030-01-07 is a Monday (weekday 1)
    await c.create('doctorSchedule', { doctorId: s.doc.id, weekday: 1, from: '09:00', to: '12:00' });
    expect((await c.create('appointment', appt(s, { startTime: '11:00' }))).status).toBe(201);
    const out = await c.create('appointment', appt(s, { startTime: '13:00' })); expect(out.status).toBe(409); expect(out.body.error.code).toBe('OUTSIDE_SCHEDULE');
    expect((await c.create('appointment', appt(s, { date: '2030-01-08', startTime: '10:00' }))).body.error.code).toBe('OUTSIDE_SCHEDULE'); // Tuesday not scheduled
  });
  it('status transitions are validated', async () => {
    const c = await clinic(); const s = await seed(c);
    const id = (await c.create('appointment', appt(s))).body.data.id;
    expect((await c.patch('appointment', id, { status: 'completed' })).status).toBe(200);
    const bad = await c.patch('appointment', id, { status: 'scheduled' }); expect(bad.status).toBe(409); expect(bad.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('billing', () => {
  async function invoice(c: C, s: Awaited<ReturnType<typeof seed>>) {
    return (await c.create('invoice', { patientId: s.pat.id, lines: [{ desc: 'Consultation', qty: 2, unitPrice: 10000 }, { desc: 'ECG', qty: 1, unitPrice: 5050 }], discount: 500, taxBp: 1400 })).body.data;
  }
  it('computes totals server-side with integer math and ignores client totals', async () => {
    const c = await clinic(); const s = await seed(c);
    const r = await c.create('invoice', { patientId: s.pat.id, lines: [{ desc: 'Consultation', qty: 2, unitPrice: 10000 }, { desc: 'ECG', qty: 1, unitPrice: 5050 }], discount: 500, taxBp: 1400, total: 1 });
    expect(r.status).toBe(201);
    const d = r.body.data.data; // subtotal 25050 - 500 = 24550 ; tax 14% = 3437 (3437.0) ; total 27987
    expect(d.subtotal).toBe(25050); expect(d.tax).toBe(3437); expect(d.total).toBe(27987); expect(d.paidAmount).toBe(0); expect(d.status).toBe('draft');
    expect(r.body.data.code).toBe('INV-0001');
  });
  it('rejects discount larger than subtotal', async () => {
    const c = await clinic(); const s = await seed(c);
    expect((await c.create('invoice', { patientId: s.pat.id, lines: [{ desc: 'x', qty: 1, unitPrice: 100 }], discount: 500 })).status).toBe(400);
  });
  it('payments: only on issued invoices, no overpay, partial -> paid, invoice becomes immutable', async () => {
    const c = await clinic(); const s = await seed(c); const inv = await invoice(c, s);
    const early = await c.create('payment', { invoiceId: inv.id, amount: 1000, method: 'cash' }); expect(early.status).toBe(409);
    expect((await c.patch('invoice', inv.id, { status: 'issued' })).status).toBe(200);
    expect((await c.create('payment', { invoiceId: inv.id, amount: 27988, method: 'cash' })).status).toBe(409); // overpay by 1
    expect((await c.create('payment', { invoiceId: inv.id, amount: 10000, method: 'card' })).status).toBe(201);
    let cur = (await c.get('invoice', inv.id)).body.data.data; expect(cur.paidAmount).toBe(10000); expect(cur.status).toBe('partially_paid');
    expect((await c.create('payment', { invoiceId: inv.id, amount: 17987, method: 'cash' })).status).toBe(201);
    cur = (await c.get('invoice', inv.id)).body.data.data; expect(cur.status).toBe('paid');
    const imm = await c.patch('invoice', inv.id, { discount: 0 }); expect(imm.status).toBe(409); expect(imm.body.error.code).toBe('IMMUTABLE');
    const pay = (await c.list('payment')).body.data[0];
    expect((await c.del('payment', pay.id)).status).toBe(405);
    expect((await c.patch('payment', pay.id, { amount: 1 })).status).toBe(405);
  });
});

describe('permissions & privacy', () => {
  async function employee(c: C, role = 'employee') {
    await c.post('/api/v1/tenant/employees', { name: 'Emp', email: `${role}@alpha.test`, password: 'Emp-Pass-1234!', role });
    const agent = request.agent(app); const l = await agent.post('/api/v1/auth/login').send({ email: `${role}@alpha.test`, password: 'Emp-Pass-1234!' });
    const csrf = l.body.data.csrfToken as string;
    return { agent, post: (u: string, b: object) => agent.post(u).set('x-csrf-token', csrf).send(b), del: (u: string) => agent.delete(u).set('x-csrf-token', csrf) };
  }
  it('front-desk employee: patients/appointments yes, medical records/prescriptions no, no deletes', async () => {
    const c = await clinic(); const s = await seed(c); const e = await employee(c);
    expect((await e.agent.get('/api/v1/tenant/p/patient')).status).toBe(200);
    expect((await e.post('/api/v1/tenant/p/appointment', appt(s))).status).toBe(201);
    expect((await e.agent.get('/api/v1/tenant/p/medicalRecord')).status).toBe(403);
    expect((await e.agent.get('/api/v1/tenant/p/prescription')).status).toBe(403);
    expect((await e.del(`/api/v1/tenant/p/patient/${s.pat.id}`)).status).toBe(403);
  });
  it('manager has full module access', async () => {
    const c = await clinic(); await seed(c); const m = await employee(c, 'manager');
    expect((await m.agent.get('/api/v1/tenant/p/medicalRecord')).status).toBe(200);
  });
  it('reading a sensitive medical record is audit-logged; global search hides it from employees', async () => {
    const c = await clinic(); const s = await seed(c);
    const rec = (await c.create('medicalRecord', { patientId: s.pat.id, doctorId: s.doc.id, visitDate: today, complaint: 'Chest pain', diagnosis: 'Angina' })).body.data;
    await c.get('medicalRecord', rec.id);
    const logs = (await c.agent.get('/api/v1/tenant/audit-logs')).body.data.map((x: { action: string; entityId: string }) => `${x.action}:${x.entityId}`);
    expect(logs).toContain(`record.read:${rec.id}`);
    expect((await c.agent.get('/api/v1/search?q=angina')).body.data.length + (await c.agent.get('/api/v1/search?q=ahmed')).body.data.length).toBeGreaterThan(0);
    const e = await employee(c);
    const r = (await e.agent.get('/api/v1/search?q=ahmed')).body.data as { entityType: string }[];
    expect(r.some((x) => x.entityType === 'patient')).toBe(true);
    expect((await e.agent.get('/api/v1/search?q=chest')).body.data.some((x: { entityType: string }) => x.entityType === 'medicalRecord')).toBe(false);
  });
});

describe('global search integration', () => {
  it('indexes patients/doctors/appointments/invoices; updates and deletes stay in sync', async () => {
    const c = await clinic(); const s = await seed(c); const a = (await c.create('appointment', appt(s))).body.data;
    const types = async (q: string) => (await c.agent.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).body.data.map((x: { entityType: string }) => x.entityType);
    expect(await types('hany')).toContain('doctor'); expect(await types('PT-0001')).toContain('patient'); expect(await types(a.code)).toContain('appointment');
    await c.patch('patient', s.pat.id, { name: 'Renamed Person' }); expect(await types('renamed')).toContain('patient'); expect(await types('ahmed ali')).not.toContain('patient');
    const sp = (await c.create('specialty', { name: 'Zzz' })).body.data; expect(await types('zzz')).toContain('specialty');
    await c.del('specialty', sp.id); expect(await types('zzz')).not.toContain('specialty');
  });
});

describe('dashboard & reports', () => {
  it('KPIs are computed from real records', async () => {
    const c = await clinic(); const s = await seed(c);
    await c.create('appointment', appt(s, { date: today, startTime: '08:00' })); await c.create('appointment', appt(s, { date: today, startTime: '09:00' }));
    const inv = (await c.create('invoice', { patientId: s.pat.id, lines: [{ desc: 'x', qty: 1, unitPrice: 20000 }] })).body.data;
    await c.patch('invoice', inv.id, { status: 'issued' }); await c.create('payment', { invoiceId: inv.id, amount: 5000, method: 'cash', paidAt: new Date().toISOString() });
    const k = (await c.agent.get('/api/v1/tenant/dashboard')).body.data.kpis as Record<string, number>;
    expect(k.patients).toBe(1); expect(k.doctors).toBe(1); expect(k.appointmentsToday).toBe(2); expect(k.revenueMonth).toBe(5000);
    const rep = (await c.agent.get('/api/v1/tenant/reports/appointmentsByStatus')).body.data;
    expect(rep.find((x: { key: string }) => x.key === 'scheduled').value).toBe(2);
    expect((await c.agent.get('/api/v1/tenant/reports/nope')).status).toBe(404);
  });
});

describe('subscription rules apply to product data', () => {
  it('read-only after expiry: reads ok, writes 402', async () => {
    const c = await clinic(); await c.create('patient', { name: 'Keep Me' });
    db.$client.prepare("update subscriptions set trial_ends_at='2000-01-01T00:00:00.000Z'").run();
    expect((await c.list('patient')).body.data).toHaveLength(1);
    expect((await c.create('patient', { name: 'New One' })).status).toBe(402);
  });
  it('record limit counts product records', async () => {
    const c = await clinic(); db.$client.prepare(`update plans set limits=json_set(limits,'$.maxRecords',2)`).run();
    expect((await c.create('patient', { name: 'One One' })).status).toBe(201); expect((await c.create('patient', { name: 'Two Two' })).status).toBe(201);
    expect((await c.create('patient', { name: 'Three Three' })).body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});

describe('public website data & forms', () => {
  const host = 'alpha.codela.test';
  it('public doctor/service catalog exposes only public fields of active records', async () => {
    const c = await clinic(); const s = await seed(c);
    await c.create('doctor', { name: 'Dr. Hidden', specialtyId: s.spec.id, active: false });
    const r = await request(app).get('/api/v1/public/catalog/doctor').set('Host', host);
    expect(r.status).toBe(200); expect(r.body.data.map((d: { name: string }) => d.name)).toEqual(['Dr. Hany']);
    expect(JSON.stringify(r.body)).not.toContain('tenantId'); expect(JSON.stringify(r.body)).not.toContain('phone');
    expect((await request(app).get('/api/v1/public/catalog/patient').set('Host', host)).status).toBe(404); // private entity
    expect((await request(app).get('/api/v1/public/catalog/doctor').set('Host', 'nobody.codela.test')).status).toBe(404);
  });
  it('inquiry + appointment-request forms create records in the right tenant only; honeypot ignored', async () => {
    const a = await clinic('alpha'); const b = await clinic('beta'); const s = await seed(a);
    const f = await request(app).post('/api/v1/public/forms/inquiry').set('Host', host).send({ name: 'Visitor', phone: '01011112222', message: 'Hello' });
    expect(f.status).toBe(201);
    expect((await a.list('inquiry')).body.meta.total).toBe(1); expect((await b.list('inquiry')).body.meta.total).toBe(0);
    expect((await request(app).post('/api/v1/public/forms/inquiry').set('Host', host).send({ name: 'V', message: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/v1/public/forms/inquiry').set('Host', host).send({ name: 'Bot', phone: '01011112222', message: 'x', website: 'spam' })).status).toBe(201);
    expect((await a.list('inquiry')).body.meta.total).toBe(1);
    const ar = await request(app).post('/api/v1/public/forms/appointmentRequest').set('Host', host).send({ name: 'V', phone: '01011112222', doctorId: s.doc.id, preferredDate: '2030-02-01' });
    expect(ar.status).toBe(201);
    const evil = await request(app).post('/api/v1/public/forms/appointmentRequest').set('Host', host).send({ name: 'V', phone: '01011112222', doctorId: (await seed(b)).doc.id });
    expect(evil.status).toBe(400); // doctor of another tenant
    expect((await request(app).post('/api/v1/public/forms/patient').set('Host', host).send({ name: 'x' })).status).toBe(404); // not a public form
  });
});

describe('dashboard metadata', () => {
  it('lists the readable reports so the UI can render them', async () => {
    const c = await clinic(); const d = (await c.agent.get('/api/v1/tenant/dashboard')).body.data;
    expect(d.reports.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(['appointmentsByStatus', 'revenueByMethod'])); expect(d.reports[0]).toHaveProperty('labelAr'); expect(d.reports.find((r: { key: string }) => r.key === 'appointmentsByStatus').groupRef).toBeNull();
  });
});

describe('public online booking (real appointments, not requests)', () => {
  const H = (slug = 'alpha') => `${slug}.codela.test`;
  const off = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const nextDay = (weekday: number, min = 10) => { let n = min; while (new Date(`${off(n)}T00:00:00Z`).getUTCDay() !== weekday) n++; return off(n); };
  const DAY = nextDay(0);
  const av = (qs: string, h = H()) => request(app).get(`/api/v1/public/actions/availability?${qs}`).set('Host', h);
  const book = (b: object, h = H()) => request(app).post('/api/v1/public/actions/book').set('Host', h).send(b);
  const st = (code: string, phone: string, h = H()) => request(app).get(`/api/v1/public/actions/status?code=${code}&phone=${phone}`).set('Host', h);
  const cancel = (code: string, phone: string, h = H()) => request(app).post('/api/v1/public/actions/cancel').set('Host', h).send({ code, phone });

  it('offers only free slots from the doctor schedule; booking creates the patient + a scheduled appointment the reception sees; the slot is then taken', async () => {
    const c = await clinic(); const s = await seed(c);
    expect((await av(`date=${DAY}`)).body.data).toEqual([]); // no schedule => not bookable online
    await c.create('doctorSchedule', { doctorId: s.doc.id, weekday: 0, from: '10:00', to: '12:00' });
    const free = (await av(`date=${DAY}&doctorId=${s.doc.id}`)).body.data[0];
    expect(free.doctorName).toBe('Dr. Hany'); expect(free.slots).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
    const r = await book({ doctorId: s.doc.id, date: DAY, startTime: '10:00', patient: { name: 'Mona Salem', phone: '٠١٠٠٥٥٥٦٦٦٧' } });
    expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ status: 'scheduled', startTime: '10:00', doctorName: 'Dr. Hany' });
    const list = (await c.list('appointment', `?date=${DAY}`)).body.data as { id: string; data: { patientId: string; status: string; notes: string } }[];
    expect(list).toHaveLength(1); expect(list[0].data.status).toBe('scheduled'); expect(list[0].data.notes).toBe('Booked online');
    const after = (await av(`date=${DAY}&doctorId=${s.doc.id}`)).body.data[0].slots as string[];
    expect(after).not.toContain('10:00'); expect(after).not.toContain('10:15'); expect(after).toContain('10:30');
    expect((await book({ doctorId: s.doc.id, date: DAY, startTime: '10:15', patient: { name: 'Other', phone: '01009998887' } })).status).toBe(409);
    // the same phone reuses the patient record instead of creating a duplicate, and never overwrites it
    const again = await book({ doctorId: s.doc.id, date: DAY, startTime: '11:00', patient: { name: 'Hacker Name', phone: '01005556667' } }); expect(again.status).toBe(201);
    const pats = (await c.list('patient', '?q=0100555')).body.data as { data: { name: string } }[]; expect(pats).toHaveLength(1); expect(pats[0].data.name).toBe('Mona Salem');
  });

  it('rejects unknown doctors, off-schedule/past/off-grid times and bad input; another clinic cannot book this clinic\'s doctor', async () => {
    const c = await clinic(); const s = await seed(c); await clinic('beta');
    await c.create('doctorSchedule', { doctorId: s.doc.id, weekday: 0, from: '10:00', to: '12:00' });
    const ok = { doctorId: s.doc.id, date: DAY, startTime: '10:00', patient: { name: 'Mona Salem', phone: '01005556667' } };
    expect((await book({ ...ok, doctorId: 'nope' })).status).toBe(400);
    expect((await book({ ...ok, startTime: '09:00' })).status).toBe(409); expect((await book({ ...ok, startTime: '11:45' })).status).toBe(409); expect((await book({ ...ok, startTime: '10:07' })).status).toBe(409);
    expect((await book({ ...ok, date: '2020-01-05' })).status).toBe(409); expect((await book({ ...ok, patient: { name: 'M', phone: '1' } })).status).toBe(400);
    expect((await book(ok, H('beta'))).status).toBe(400); expect((await av(`date=${DAY}&doctorId=${s.doc.id}`, H('beta'))).body.data).toEqual([]);
    expect((await av('date=not-a-date')).status).toBe(400);
  });

  it('the patient tracks and cancels with code + phone only; cancelling frees the slot; confirmed ones can be cancelled, completed ones cannot', async () => {
    const c = await clinic(); const s = await seed(c); await c.create('doctorSchedule', { doctorId: s.doc.id, weekday: 0, from: '10:00', to: '12:00' });
    const r = (await book({ doctorId: s.doc.id, date: DAY, startTime: '10:00', patient: { name: 'Mona Salem', phone: '01005556667' } })).body.data;
    expect((await st(r.code, '01000000000')).status).toBe(404); expect((await st(r.code, '01005556667', H('beta'))).status).toBe(404);
    expect((await st(r.code, '01005556667')).body.data).toMatchObject({ status: 'scheduled', doctorName: 'Dr. Hany' });
    expect((await cancel(r.code, '01000000000')).status).toBe(404);
    expect((await cancel(r.code, '01005556667')).status).toBe(200);
    expect((await av(`date=${DAY}&doctorId=${s.doc.id}`)).body.data[0].slots).toContain('10:00');
    expect((await cancel(r.code, '01005556667')).body.error.code).toBe('NOT_CANCELLABLE');
    const r2 = (await book({ doctorId: s.doc.id, date: DAY, startTime: '10:30', patient: { name: 'Mona Salem', phone: '01005556667' } })).body.data;
    const id = ((await c.list('appointment', `?q=${DAY}`)).body.data as { id: string; code: string }[]).find((x) => x.code === r2.code)!.id;
    await c.patch('appointment', id, { status: 'confirmed' }); await c.patch('appointment', id, { status: 'completed' });
    expect((await cancel(r2.code, '01005556667')).body.error.code).toBe('NOT_CANCELLABLE');
  });

  it('working hours are public for the doctor profile, without private data', async () => {
    const c = await clinic(); const s = await seed(c); await c.create('doctorSchedule', { doctorId: s.doc.id, weekday: 0, from: '10:00', to: '12:00' });
    const pub = await request(app).get('/api/v1/public/catalog/doctorSchedule').set('Host', H());
    expect(pub.status).toBe(200); expect(pub.body.data[0]).toMatchObject({ weekday: 0, from: '10:00', to: '12:00' });
  });
});

describe('public clinic content (FAQ, articles, doctor photo)', () => {
  it('only active FAQs and published articles are public; doctor photo is a public field; drafts stay hidden', async () => {
    const c = await clinic(); const H = 'alpha.codela.test';
    await c.create('faq', { question: 'Do you take insurance?', answer: 'Yes, most.', position: 2 }); await c.create('faq', { question: 'Hidden?', answer: 'x', active: false });
    await c.create('article', { title: 'Healthy heart', summary: 'tips', body: 'long text', published: true }); await c.create('article', { title: 'Draft piece', body: 'wip' });
    await c.create('doctor', { name: 'Dr. Photo', image: 'https://example.com/a.jpg', phone: '01001234568' });
    const pub = (e: string) => request(app).get(`/api/v1/public/catalog/${e}`).set('Host', H);
    expect((await pub('faq')).body.data.map((x: { question: string }) => x.question)).toEqual(['Do you take insurance?']);
    expect((await pub('article')).body.data.map((x: { title: string }) => x.title)).toEqual(['Healthy heart']);
    const d = (await pub('doctor')).body.data[0]; expect(d.image).toBe('https://example.com/a.jpg'); expect(d.phone).toBeUndefined();
  });
});

describe('visit -> invoice workflow', () => {
  it('completing an appointment prepares one draft invoice (service price, else doctor fee); none without a price; reception can issue and collect', async () => {
    const c = await clinic(); const s = await seed(c);
    const svc = (await c.create('service', { name: 'ECG', price: 25000, durationMin: 20 })).body.data;
    const a1 = (await c.create('appointment', appt(s, { serviceId: svc.id }))).body.data; await c.patch('appointment', a1.id, { status: 'confirmed' });
    expect((await c.list('invoice')).body.data).toHaveLength(0);
    await c.patch('appointment', a1.id, { status: 'completed' });
    const inv = (await c.list('invoice')).body.data as { id: string; data: { status: string; total: number; appointmentId: string; patientId: string } }[];
    expect(inv).toHaveLength(1); expect(inv[0].data).toMatchObject({ status: 'draft', total: 25000, appointmentId: a1.id, patientId: s.pat.id });
    const a2 = (await c.create('appointment', appt(s, { startTime: '12:00' }))).body.data; await c.patch('appointment', a2.id, { status: 'completed' }); // doctor fee 30000
    expect((await c.list('invoice')).body.data.map((i: { data: { total: number } }) => i.data.total).sort()).toEqual([25000, 30000]);
    const free = (await c.create('doctor', { name: 'Dr. Free' })).body.data; const a3 = (await c.create('appointment', appt(s, { doctorId: free.id, startTime: '13:00' }))).body.data;
    await c.patch('appointment', a3.id, { status: 'completed' }); expect((await c.list('invoice')).body.data).toHaveLength(2); // no price -> nothing invented
    const id = inv[0].id; expect((await c.patch('invoice', id, { status: 'issued' })).status).toBe(200);
    expect((await c.create('payment', { invoiceId: id, amount: 25000, method: 'cash' })).status).toBe(201);
    expect((await c.get('invoice', id)).body.data.data.status).toBe('paid');
  });
});

describe('pharmacy, radiology, branches/map, clinic timezone', () => {
  it('pharmacy: stock only moves through the ledger; a dispense prices from the catalogue, checks stock atomically, and cancelling returns stock', async () => {
    const c = await clinic(); const s = await seed(c);
    const m = (await c.create('medication', { name: 'Paracetamol 500', sku: 'PARA500', price: 2500, stock: 999 })).body.data; expect(m.data.stock).toBe(0);
    await c.create('medicationMovement', { medicationId: m.id, type: 'in', qty: 20 });
    expect((await c.create('dispense', { patientId: s.pat.id, paymentMethod: 'cash', total: 1, lines: [{ medicationId: m.id, qty: 50 }] })).body.error.code).toBe('INSUFFICIENT_STOCK');
    const d = (await c.create('dispense', { patientId: s.pat.id, paymentMethod: 'cash', total: 1, lines: [{ medicationId: m.id, qty: 4 }] })).body.data;
    expect(d.data).toMatchObject({ total: 10000, status: 'dispensed' }); const stock = async () => (await c.get('medication', m.id)).body.data.data.stock; expect(await stock()).toBe(16);
    expect((await c.patch('dispense', d.id, { status: 'cancelled' })).status).toBe(200); expect(await stock()).toBe(20);
    expect((await c.patch('dispense', d.id, { status: 'dispensed' })).status).not.toBe(200);
    expect((await c.create('medication', { name: 'Dup', sku: 'PARA500', price: 1 })).status).toBe(409);
  });
  it('radiology: requested -> scheduled -> performed -> reported, a report text is required, no skipping', async () => {
    const c = await clinic(); const s = await seed(c);
    const r = (await c.create('imagingRequest', { patientId: s.pat.id, doctorId: s.doc.id, modality: 'xray', bodyPart: 'Chest' })).body.data;
    expect((await c.patch('imagingRequest', r.id, { status: 'reported', reportText: 'x' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await c.patch('imagingRequest', r.id, { status: 'performed' })).status).toBe(200);
    expect((await c.patch('imagingRequest', r.id, { status: 'reported' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await c.patch('imagingRequest', r.id, { status: 'reported', reportText: 'Clear lung fields.' })).status).toBe(200);
    expect((await c.get('imagingRequest', r.id)).body.data.data.reportedAt).toBeTruthy();
  });
  it('branches with a map are public; online slots carry the branch of the schedule window; the booking stores it', async () => {
    const c = await clinic(); const s = await seed(c); const H = 'alpha.codela.test'; const DAY = (() => { for (let n = 10; ; n++) { const d = new Date(Date.now() + n * 86_400_000); if (d.getUTCDay() === 0) return d.toISOString().slice(0, 10); } })();
    const b1 = (await c.create('branch', { name: 'Maadi', address: '1 Road 9', mapEmbedUrl: 'https://www.google.com/maps/embed?pb=abc' })).body.data; await c.create('branch', { name: 'Closed', active: false });
    await c.create('doctorSchedule', { doctorId: s.doc.id, branchId: b1.id, weekday: 0, from: '10:00', to: '11:00' });
    const pub = (await request(app).get('/api/v1/public/catalog/branch').set('Host', H)).body.data; expect(pub.map((x: { name: string }) => x.name)).toEqual(['Maadi']); expect(pub[0].mapEmbedUrl).toContain('google.com/maps/embed');
    expect((await c.create('branch', { name: 'Bad', mapUrl: 'javascript:alert(1)' })).status).toBe(400);
    const av = (await request(app).get(`/api/v1/public/actions/availability?date=${DAY}&doctorId=${s.doc.id}`).set('Host', H)).body.data[0]; expect(av.branches['10:00']).toBe(b1.id);
    const r = await request(app).post('/api/v1/public/actions/book').set('Host', H).send({ doctorId: s.doc.id, date: DAY, startTime: '10:00', patient: { name: 'Mona Salem', phone: '01005556667' } }); expect(r.status).toBe(201);
    expect(((await c.list('appointment', `?date=${DAY}`)).body.data as { data: { branchId: string } }[])[0].data.branchId).toBe(b1.id);
  });
  it('"in the past" follows the clinic timezone, not UTC', async () => {
    const c = await clinic(); const s = await seed(c); const H = 'alpha.codela.test';
    await c.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', c.csrf).send({ timezone: 'Pacific/Kiritimati' }); // UTC+14: local date is usually "tomorrow" in UTC terms
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const wd = new Date(`${local}T00:00:00Z`).getUTCDay(); await c.create('doctorSchedule', { doctorId: s.doc.id, weekday: wd, from: '00:00', to: '23:45' });
    const slots = (await request(app).get(`/api/v1/public/actions/availability?date=${local}&doctorId=${s.doc.id}`).set('Host', H)).body.data[0]?.slots as string[] | undefined;
    const nowMin = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Kiritimati', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).slice(0, 2)) * 60;
    expect(slots === undefined || slots.every((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) > nowMin - 1)).toBe(true);
    expect((await request(app).get('/api/v1/public/actions/availability?date=2020-01-05').set('Host', H)).body.data).toEqual([]);
  });
});

describe('specialised staff roles, lab catalogue and public rescheduling', () => {
  const PW = 'Staff-Pass-1234!';
  async function staffAs(c: C, role: string) {
    const email = `${role}@${c.tenantId.slice(0, 6)}.test`;
    expect((await c.post('/api/v1/tenant/employees', { name: `${role} user`, email, password: PW, role })).status).toBe(201);
    const a = request.agent(app); const l = await a.post('/api/v1/auth/login').send({ email, password: PW }); expect(l.status).toBe(200); const csrf = l.body.data.csrfToken as string;
    const b = '/api/v1/tenant/p';
    return { list: (e: string) => a.get(`${b}/${e}`), create: (e: string, body: object) => a.post(`${b}/${e}`).set('x-csrf-token', csrf).send(body), patch: (e: string, id: string, body: object) => a.patch(`${b}/${e}/${id}`).set('x-csrf-token', csrf).send(body) };
  }

  it('pharmacist, lab technician and radiology technician only reach their own modules (API-enforced)', async () => {
    const c = await clinic('alpha'); const s = await seed(c); const c2 = await clinic('beta');
    const names = (await c.agent.get('/api/v1/tenant/roles')).body.data.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining(['pharmacist', 'lab_technician', 'radiology_technician']));
    const lab = await staffAs(c, 'lab_technician'); const rad = await staffAs(c2, 'radiology_technician');
    const req = (await c.create('labRequest', { patientId: s.pat.id, doctorId: s.doc.id, test: 'CBC' })).body.data;
    expect((await lab.list('labRequest')).status).toBe(200);
    expect((await lab.patch('labRequest', req.id, { status: 'sample_collected' })).status).toBe(200);
    expect((await lab.patch('labRequest', req.id, { status: 'resulted' })).status).toBe(400); // a result is required
    expect((await lab.patch('labRequest', req.id, { status: 'resulted', results: [{ parameter: 'Hemoglobin', value: '13.5', unit: 'g/dL', range: '12-16' }] })).status).toBe(200);
    expect((await lab.create('labTest', { name: 'CBC', price: 15000, sampleType: 'blood' })).status).toBe(201);
    for (const e of ['invoice', 'payment', 'medicalRecord', 'prescription', 'appointment', 'dispense', 'imagingRequest', 'medication']) expect((await lab.list(e)).status, `lab ${e}`).toBe(403);
    expect((await lab.create('patient', { name: 'No Access' })).status).toBe(403);
    for (const e of ['labRequest', 'invoice', 'medicalRecord', 'appointment', 'dispense']) expect((await rad.list(e)).status, `radiology ${e}`).toBe(403);
    expect((await rad.list('imagingRequest')).status).toBe(200);
  });

  it('pharmacist works the pharmacy only', async () => {
    const c = await clinic('gamma'); const ph = await staffAs(c, 'pharmacist');
    expect((await ph.create('medication', { name: 'Paracetamol', sku: 'PARA-500', price: 2500 })).status).toBe(201);
    expect((await ph.list('dispense')).status).toBe(200);
    for (const e of ['invoice', 'payment', 'labRequest', 'imagingRequest', 'appointment', 'medicalRecord']) expect((await ph.list(e)).status, `pharmacist ${e}`).toBe(403);
  });

  it('the patient reschedules from the public site with code + phone; the slot is re-validated and the old one is freed', async () => {
    const c = await clinic('delta'); const s = await seed(c);
    const off = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    let n = 3; while (new Date(`${off(n)}T00:00:00Z`).getUTCDay() !== 0) n++; const DAY = off(n);
    await c.create('doctorSchedule', { doctorId: s.doc.id, weekday: 0, from: '10:00', to: '12:00' });
    const H = 'delta.codela.test';
    const book = (b: object) => request(app).post('/api/v1/public/actions/book').set('Host', H).send(b);
    const rs = (b: object) => request(app).post('/api/v1/public/actions/reschedule').set('Host', H).send(b);
    const a = await book({ doctorId: s.doc.id, date: DAY, startTime: '10:00', patient: { name: 'Mona Salem', phone: '01005556667' } });
    const b = await book({ doctorId: s.doc.id, date: DAY, startTime: '11:00', patient: { name: 'Other One', phone: '01009998887' } });
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect((await rs({ code: a.body.data.code, phone: '01000000000', date: DAY, startTime: '10:30' })).status).toBe(404);   // stranger
    expect((await rs({ code: a.body.data.code, phone: '01005556667', date: DAY, startTime: '11:00' })).status).toBe(409);   // taken by someone else
    expect((await rs({ code: a.body.data.code, phone: '01005556667', date: DAY, startTime: '10:15' })).status).toBe(200);   // overlaps its own old slot: allowed
    expect((await rs({ code: a.body.data.code, phone: '01005556667', date: DAY, startTime: '09:00' })).status).toBe(409);   // outside the doctor's schedule
    const mine = (await c.list('appointment', `?date=${DAY}`)).body.data.find((x: { code: string }) => x.code === a.body.data.code);
    expect(mine.data.startTime).toBe('10:15');
    await request(app).post('/api/v1/public/actions/cancel').set('Host', H).send({ code: a.body.data.code, phone: '01005556667' });
    expect((await rs({ code: a.body.data.code, phone: '01005556667', date: DAY, startTime: '10:00' })).status).toBe(409);   // cancelled ones cannot move
  });
});
