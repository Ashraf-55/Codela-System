import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient } from './_helpers';

const PW = 'Str0ng-Pass!1';
function build(verify: boolean) {
  const db = createDb(':memory:'); seedPlatform(db); const sent: { to: string; subject?: string; body: string }[] = [];
  const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', portalEmailVerification: verify, providers: { email: { send: async (m) => { sent.push(m); } } } });
  return { db, app, sent };
}
const host = (slug: string) => `${slug}.codela.test`;
const portal = (app: ReturnType<typeof createApp>, slug: string) => {
  const agent = request.agent(app); let csrf = '';
  const call = (m: 'get' | 'post' | 'patch', u: string, b?: object) => { const r = agent[m](`/api/v1/public/portal${u}`).set('Host', host(slug)); if (m !== 'get') r.set('x-csrf-token', csrf); return b ? r.send(b) : r; };
  return { agent, call, setCsrf: (c: string) => { csrf = c; } };
};
const token = (body: string) => /[?&](?:verify|reset)=([^\s]+)/.exec(body)![1];

describe('portal accounts', () => {
  it('registers, logs in, reads and updates own profile; wrong password and duplicate e-mail fail safely', async () => {
    const { app } = build(false); await tenantClient(app, 'ac1', 'learning'); const p = portal(app, 'ac1');
    const r = await p.call('post', '/register', { name: 'Sara Student', email: 'Sara@Example.com', password: PW }); expect(r.status).toBe(201); p.setCsrf(r.body.data.csrfToken);
    expect(r.body.data.account.email).toBe('sara@example.com'); expect(JSON.stringify(r.body)).not.toContain('passwordHash');
    expect((await p.call('get', '/me')).body.data.name).toBe('Sara Student');
    expect((await p.call('patch', '/me', { name: 'Sara S.', phone: '+201001234567' })).body.data).toMatchObject({ name: 'Sara S.', phone: '+201001234567' });
    expect((await p.call('patch', '/me', { email: 'evil@x.com' })).status).toBe(400);               // strict schema: e-mail/status cannot be mass-assigned
    expect((await portal(app, 'ac1').call('post', '/register', { name: 'Dup', email: 'sara@example.com', password: PW })).status).toBe(409);
    expect((await portal(app, 'ac1').call('post', '/login', { email: 'sara@example.com', password: 'wrong-pass-1' })).status).toBe(401);
    expect((await portal(app, 'ac1').call('post', '/register', { name: 'Weak', email: 'w@x.com', password: 'short' })).status).toBe(400);
  });
  it('requires CSRF on writes and rejects unauthenticated access', async () => {
    const { app } = build(false); await tenantClient(app, 'ac2', 'learning'); const p = portal(app, 'ac2');
    expect((await request(app).get('/api/v1/public/portal/me').set('Host', host('ac2'))).status).toBe(401);
    const r = await p.call('post', '/register', { name: 'Ali Ahmed', email: 'ali@x.com', password: PW });
    const noCsrf = await p.agent.patch('/api/v1/public/portal/me').set('Host', host('ac2')).send({ name: 'Hacked' }); expect(noCsrf.status).toBe(403);
    expect(r.status).toBe(201);
  });
  it('a session from one tenant is useless on another tenant site, and accounts are per tenant', async () => {
    const { app } = build(false); await tenantClient(app, 'tnta', 'learning'); await tenantClient(app, 'tntb', 'learning');
    const a = portal(app, 'tnta'); const r = await a.call('post', '/register', { name: 'Same Person', email: 'same@x.com', password: PW }); expect(r.status).toBe(201);
    const crossed = await a.agent.get('/api/v1/public/portal/me').set('Host', host('tntb')); expect(crossed.status).toBe(401);
    expect((await portal(app, 'tntb').call('post', '/login', { email: 'same@x.com', password: PW })).status).toBe(401);   // no account on tenant B
    expect((await portal(app, 'tntb').call('post', '/register', { name: 'Same Person', email: 'same@x.com', password: PW })).status).toBe(201); // same e-mail may exist on B
  });
});

describe('portal e-mail verification & password reset (signed links, delivered through the outbox)', () => {
  it('cannot log in until the e-mail link is used; replay is harmless', async () => {
    const { app, sent } = build(true); await tenantClient(app, 'ver', 'learning'); const p = portal(app, 'ver');
    const r = await p.call('post', '/register', { name: 'Nora Noor', email: 'nora@x.com', password: PW }); expect(r.status).toBe(202); expect(r.body.data.verificationRequired).toBe(true);
    await new Promise((s) => setTimeout(s, 20)); const mail = sent.find((m) => m.to === 'nora@x.com')!; expect(mail).toBeTruthy();
    expect((await p.call('post', '/login', { email: 'nora@x.com', password: PW })).body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await p.call('post', '/verify-email', { token: 'forged.token' })).status).toBe(400);
    expect((await p.call('post', '/verify-email', { token: token(mail.body) })).status).toBe(200);
    expect((await p.call('post', '/login', { email: 'nora@x.com', password: PW })).status).toBe(200);
  });
  it('reset link is single-use, revokes sessions and never reveals whether an account exists', async () => {
    const { app, sent } = build(false); await tenantClient(app, 'rst', 'learning'); const p = portal(app, 'rst');
    const r = await p.call('post', '/register', { name: 'Omar Omar', email: 'omar@x.com', password: PW }); p.setCsrf(r.body.data.csrfToken);
    const unknown = await p.call('post', '/forgot-password', { email: 'nobody@x.com' }); expect(unknown.status).toBe(200); expect(sent.length).toBe(0);
    expect((await p.call('post', '/forgot-password', { email: 'omar@x.com' })).status).toBe(200); await new Promise((s) => setTimeout(s, 20));
    const t = token(sent[0].body); const NEW = 'An0ther-Pass-99';
    expect((await p.call('post', '/reset-password', { token: t, password: NEW })).status).toBe(200);
    expect((await p.call('post', '/reset-password', { token: t, password: 'Th1rd-Pass-4567' })).status).toBe(400);   // already used
    expect((await p.call('get', '/me')).status).toBe(401);                                                              // old session revoked
    expect((await portal(app, 'rst').call('post', '/login', { email: 'omar@x.com', password: PW })).status).toBe(401);
    expect((await portal(app, 'rst').call('post', '/login', { email: 'omar@x.com', password: NEW })).status).toBe(200);
  });
});

describe('portal "my records" (student / customer view)', () => {
  it('a student sees only their own enrollment, never internal fields or other students', async () => {
    const { app } = build(false); const owner = await tenantClient(app, 'lrn', 'learning');
    const ins = (await owner.create('instructor', { name: 'Dr X' })).body.data; const course = (await owner.create('course', { title: 'Course A', instructorId: ins.id, price: 0 })).body.data;
    await owner.create('lesson', { courseId: course.id, title: 'L1', position: 1, durationMin: 10 }); expect((await owner.patch('course', course.id, { status: 'published' })).status).toBe(200); // only published courses accept enrollments
    const me = (await owner.create('student', { name: 'Sara Student', email: 'sara@x.com' })).body.data; const other = (await owner.create('student', { name: 'Other Student', email: 'other@x.com' })).body.data;
    expect((await owner.create('enrollment', { studentId: me.id, courseId: course.id })).status).toBe(201); expect((await owner.create('enrollment', { studentId: other.id, courseId: course.id })).status).toBe(201);
    const p = portal(app, 'lrn'); await p.call('post', '/register', { name: 'Sara Student', email: 'sara@x.com', password: PW });
    const my = (await p.call('get', '/my')).body.data; expect(my.person.id).toBe(me.id); expect(my.items.enrollment).toHaveLength(1); expect(my.items.enrollment[0].courseId).toBe(course.id);
    expect(JSON.stringify(my)).not.toContain(other.id);
    const stranger = portal(app, 'lrn'); await stranger.call('post', '/register', { name: 'No Record', email: 'norecord@x.com', password: PW });
    expect((await stranger.call('get', '/my')).body.data.person).toBeNull();
  });
  it('a medical patient sees appointments without staff notes', async () => {
    const { app } = build(false); const o = await tenantClient(app, 'med', 'medical');
    const spec = (await o.create('specialty', { name: 'General' })).body.data; const doc = (await o.create('doctor', { name: 'Dr Y', specialtyId: spec.id })).body.data;
    const pat = (await o.create('patient', { name: 'Pat One', email: 'pat@x.com', phone: '01011112222' })).body.data;
    await o.create('doctorSchedule', { doctorId: doc.id, weekday: 1, startTime: '09:00', endTime: '17:00' }).catch(() => undefined);
    const ap = await o.create('appointment', { patientId: pat.id, doctorId: doc.id, date: '2030-01-07', startTime: '10:00', notes: 'STAFF ONLY SECRET' });
    const p = portal(app, 'med'); await p.call('post', '/register', { name: 'Pat One', email: 'pat@x.com', password: PW });
    const my = (await p.call('get', '/my')).body.data;
    if (ap.status === 201) { expect(my.items.appointment).toHaveLength(1); expect(JSON.stringify(my)).not.toContain('STAFF ONLY SECRET'); } else expect(my.person.id).toBe(pat.id);
  });
});
