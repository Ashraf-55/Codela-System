import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

type T = Awaited<ReturnType<typeof tenantClient>>;
const as = async (app: ReturnType<typeof setup>['app'], owner: T, slug: string, role: string, n = 1) => {
  const email = `s${n}@${slug}.test`; const c = await owner.post('/api/v1/tenant/employees', { name: 'Staff Member', email, password: 'Emp-Pass-1234!', role }); expect(c.status, JSON.stringify(c.body)).toBe(201);
  const agent = request.agent(app); const l = await agent.post('/api/v1/auth/login').send({ email, password: 'Emp-Pass-1234!' });
  return { agent, csrf: l.body.data.csrfToken as string, id: c.body.data.id as string };
};

describe('custom roles (tenant-configurable permission sets)', () => {
  it('the owner builds a role from the product catalogue; reserved names, wildcards and owner-only powers are refused', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'gov-a', 'learning');
    const cat = (await o.agent.get('/api/v1/tenant/permission-catalog')).body.data as { modules: { module: string; actions: string[] }[]; core: string[] };
    expect(cat.modules.find((m) => m.module === 'students')!.actions).toEqual(expect.arrayContaining(['read', 'create', 'update', 'delete', 'export']));
    expect(cat.modules.find((m) => m.module === 'payments')!.actions).toContain('approve'); expect(cat.modules.find((m) => m.module === 'students')!.actions).not.toContain('approve');
    const mk = (b: object) => o.post('/api/v1/tenant/roles', b);
    expect((await mk({ name: 'owner', permissions: ['students.read'] })).status).toBe(409);
    expect((await mk({ name: 'Bad Name!', permissions: ['students.read'] })).status).toBe(400);
    for (const bad of ['*', 'students.*', 'roles.manage', 'employees.manage', 'subscription.manage', 'tenant.settings', 'students.approve', 'nonsense.read'])
      expect((await mk({ name: 'sneaky', permissions: ['students.read', bad] })).status, bad).toBe(400);
    const ok = await mk({ name: 'front_desk', permissions: ['students.read', 'students.create', 'reports.read'] }); expect(ok.status).toBe(201);
    expect((await mk({ name: 'front_desk', permissions: ['students.read'] })).status).toBe(409);
    const list = (await o.agent.get('/api/v1/tenant/roles')).body.data as { name: string; custom: boolean; permissions?: string[] }[];
    expect(list.find((r) => r.name === 'front_desk')).toMatchObject({ custom: true, permissions: ['reports.read', 'students.create', 'students.read'] });
    const other = await tenantClient(app, 'gov-b', 'learning'); expect(((await other.agent.get('/api/v1/tenant/roles')).body.data as { name: string }[]).some((r) => r.name === 'front_desk')).toBe(false);
  });

  it('staff get exactly the role permissions; changes apply at once; a role in use cannot be deleted; only the owner manages roles', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'gov-c', 'learning');
    expect((await o.post('/api/v1/tenant/roles', { name: 'front_desk', permissions: ['students.read', 'students.create'] })).status).toBe(201);
    const s = await as(app, o, 'gov-c', 'front_desk'); const call = (m: 'get' | 'post' | 'delete', u: string, b?: object) => (m === 'get' ? s.agent.get(u) : s.agent[m](u).set('x-csrf-token', s.csrf).send(b ?? {}));
    expect((await call('get', '/api/v1/tenant/p/student')).status).toBe(200); expect((await call('post', '/api/v1/tenant/p/student', { name: 'Ali', email: 'ali@x.com', phone: '01000000001' })).status).toBe(201);
    expect((await call('get', '/api/v1/tenant/p/course')).status).toBe(403); expect((await call('post', '/api/v1/tenant/roles', { name: 'mine', permissions: ['students.read'] })).status).toBe(403);
    expect((await o.agent.put('/api/v1/tenant/roles/front_desk').set('x-csrf-token', o.csrf).send({ permissions: ['students.read', 'courses.read'] })).status).toBe(200);
    expect((await call('get', '/api/v1/tenant/p/course')).status).toBe(200); expect((await call('post', '/api/v1/tenant/p/student', { name: 'Eve', email: 'eve@x.com', phone: '01000000002' })).status).toBe(403);
    expect((await o.agent.delete('/api/v1/tenant/roles/front_desk').set('x-csrf-token', o.csrf)).status).toBe(409);
    expect((await o.agent.put(`/api/v1/tenant/employees/${s.id}/role`).set('x-csrf-token', o.csrf).send({ role: 'employee' })).status).toBe(200);
    expect((await o.agent.delete('/api/v1/tenant/roles/front_desk').set('x-csrf-token', o.csrf)).status).toBe(200);
    expect((await o.agent.delete('/api/v1/tenant/roles/manager').set('x-csrf-token', o.csrf)).status).toBe(409); // built-in roles are never editable
    expect((await o.agent.put(`/api/v1/tenant/employees/${s.id}/role`).set('x-csrf-token', o.csrf).send({ role: 'owner' })).status).toBe(400);
    const log = (await o.agent.get('/api/v1/tenant/audit-logs')).body.data as { action: string }[]; for (const a of ['role.created', 'role.updated', 'role.deleted', 'employee.role_changed']) expect(log.some((x) => x.action === a), a).toBe(true);
  });
});

describe('export permission: CSV is gated, tenant-scoped, formula-safe and audited', () => {
  it('needs <module>.export; neutralises spreadsheet formulas; never includes another tenant; is audited', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'gov-d', 'learning'); const other = await tenantClient(app, 'gov-e', 'learning');
    await o.create('student', { name: '=HYPERLINK("http://evil","x")', email: 'a@x.com', phone: '01000000011' }); await o.create('student', { name: 'Mona, "Q" Ali', email: 'm@x.com', phone: '01000000012' });
    await other.create('student', { name: 'Foreign Student', email: 'f@x.com', phone: '01000000013' });
    const exp = await o.agent.get('/api/v1/tenant/p/student/export.csv'); expect(exp.status).toBe(200); expect(exp.headers['content-type']).toContain('text/csv'); expect(exp.headers['content-disposition']).toContain('student.csv');
    const text = exp.text; expect(text.charCodeAt(0)).toBe(0xfeff); expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`); expect(text).toContain('"Mona, ""Q"" Ali"'); expect(text).not.toContain('Foreign Student');
    expect(text.split('\r\n')).toHaveLength(3); // header + 2 rows
    expect((await o.agent.get('/api/v1/tenant/p/student/export.csv?q=Mona')).text.split('\r\n')).toHaveLength(2);

    expect((await o.post('/api/v1/tenant/roles', { name: 'reader', permissions: ['students.read'] })).status).toBe(201); expect((await o.post('/api/v1/tenant/roles', { name: 'exporter', permissions: ['students.read', 'students.export'] })).status).toBe(201);
    const r1 = await as(app, o, 'gov-d', 'reader', 1); const r2 = await as(app, o, 'gov-d', 'exporter', 2); // (the Starter plan allows 3 staff accounts; the built-in employee role has no *.export either)
    expect((await r1.agent.get('/api/v1/tenant/p/student/export.csv')).status).toBe(403); expect((await r2.agent.get('/api/v1/tenant/p/student/export.csv')).status).toBe(200);
    expect((await o.agent.get('/api/v1/tenant/p/course/export.csv')).status).toBe(200); expect((await request(app).get('/api/v1/tenant/p/student/export.csv')).status).toBe(401);
    const log = (await o.agent.get('/api/v1/tenant/audit-logs')).body.data as { action: string; entity: string }[]; expect(log.filter((x) => x.action === 'record.export' && x.entity === 'student').length).toBeGreaterThanOrEqual(3);
    const meta = (await o.agent.get('/api/v1/tenant/p-meta')).body.data.entities.find((e: { key: string }) => e.key === 'student'); expect(meta).toMatchObject({ canExport: true });
  });
});

describe('approve permission: deciding a payment needs `approve`, not just `update`', () => {
  it('a role with payments.update but not payments.approve is refused; with approve it works', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'gov-f', 'learning'); const host = 'gov-f.codela.test';
    const ins = (await o.create('instructor', { name: 'Dr X' })).body.data; const course = (await o.create('course', { title: 'C', instructorId: ins.id, price: 50000 })).body.data;
    await o.create('lesson', { courseId: course.id, title: 'L1', position: 1, durationMin: 5 }); await o.patch('course', course.id, { status: 'published' });
    const st = (await o.create('student', { name: 'Sara', email: 'sara@x.com', phone: '01011112222' })).body.data; await o.create('enrollment', { studentId: st.id, courseId: course.id });
    await o.create('paymentAccount', { method: 'instapay', handle: 'academy@instapay', accountName: 'Academy' });
    for (const ref of ['IP-1', 'IP-2']) expect((await request(app).post('/api/v1/public/actions/submitPayment').set('Host', host).send({ code: 'EN-0001', phone: '01011112222', method: 'instapay', amount: 1000, reference: ref })).status).toBe(201);
    const reqs = (await o.list('paymentRequest')).body.data as { id: string }[];
    expect((await o.post('/api/v1/tenant/roles', { name: 'cashier_plus', permissions: ['payments.read', 'payments.update'] })).status).toBe(201); expect((await o.post('/api/v1/tenant/roles', { name: 'finance_lead', permissions: ['payments.read', 'payments.update', 'payments.approve'] })).status).toBe(201);
    const a = await as(app, o, 'gov-f', 'cashier_plus', 1); const b = await as(app, o, 'gov-f', 'finance_lead', 2); const patch = (x: { agent: request.Agent; csrf: string }, id: string, body: object) => x.agent.patch(`/api/v1/tenant/p/paymentRequest/${id}`).set('x-csrf-token', x.csrf).send(body);
    expect((await patch(a, reqs[0].id, { status: 'approved' })).status).toBe(403); expect((await patch(a, reqs[0].id, { status: 'rejected', reviewNote: 'x' })).status).toBe(403);
    expect((await patch(a, reqs[0].id, { reviewNote: 'looking at it' })).status).toBe(200); // a non-decision edit only needs update
    expect((await patch(b, reqs[0].id, { status: 'approved' })).status).toBe(200); expect((await patch(b, reqs[1].id, { status: 'rejected', reviewNote: 'unclear receipt' })).status).toBe(200);
    expect((await o.get('enrollment', ((await o.list('enrollment')).body.data as { id: string }[])[0].id)).body.data.data.paidAmount).toBe(1000);
  });
});
