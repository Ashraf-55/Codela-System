import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { employeeAgent, tenantClient } from './_helpers';

const PW = 'Str0ng-Pass!1'; const host = (s: string) => `${s}.codela.test`;
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8), Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'.repeat(40))]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from('%PDF-1.7\n%materials\n');
function build() { const dir = mkdtempSync(path.join(tmpdir(), 'codela-vid-')); const db = createDb(':memory:'); seedPlatform(db);
  return { dir, app: createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', portalEmailVerification: false, uploadDir: dir }) }; }
const vid = (t: { agent: request.Agent; csrf: string }, lessonId: string, body: Buffer, name = 'lesson.mp4') =>
  t.agent.post(`/api/v1/tenant/files/video?entityId=${lessonId}`).set('x-csrf-token', t.csrf).set('x-file-name', encodeURIComponent(name)).set('content-type', 'application/octet-stream').send(body);
async function student(app: ReturnType<typeof createApp>, slug: string, email: string) {
  const agent = request.agent(app); const r = await agent.post('/api/v1/public/portal/register').set('Host', host(slug)).send({ name: 'Sara', email, password: PW }); expect(r.status).toBe(201);
  return { get: (p: string, h: Record<string, string> = {}) => { const q = agent.get(`/api/v1/public/portal/learning${p}`).set('Host', host(slug)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => { const b = Buffer.concat(c); cb(null, String(res.headers['content-type']).includes('json') ? JSON.parse(b.toString()) : b); }); }); for (const [k, v] of Object.entries(h)) q.set(k, v); return q; } };
}

describe('hosted lesson videos and downloadable materials', () => {
  it('uploads, validates, attaches and streams (Range) only to paid students; materials download as attachments', async () => {
    const { app, dir } = build(); const o = await tenantClient(app, 'vid1', 'learning');
    const ins = (await o.create('instructor', { name: 'Dr X' })).body.data; const c = (await o.create('course', { title: 'C', instructorId: ins.id, price: 5000 })).body.data;
    const l1 = (await o.create('lesson', { courseId: c.id, title: 'Video', position: 1, kind: 'video' })).body.data;
    const l2 = (await o.create('lesson', { courseId: c.id, title: 'Notes', position: 2, kind: 'file' })).body.data;
    const l3 = (await o.create('lesson', { courseId: c.id, title: 'Free preview', position: 3, kind: 'video', isPreview: true })).body.data;
    await o.patch('course', c.id, { status: 'published' });
    // --- validation: wrong type / disguised / bad lesson / no length / too large -> nothing stays on disk
    const before = readdirSync(dir).flatMap((d) => readdirSync(path.join(dir, d))).length;
    expect((await vid(o, l1.id, PNG)).status).toBe(415);
    expect((await vid(o, l1.id, Buffer.from('<html>x</html>'.repeat(30)), 'a.mp4')).status).toBe(415);
    expect((await vid(o, 'no-such', MP4)).status).toBe(404);
    expect((await o.agent.post(`/api/v1/tenant/files?purpose=video`).set('x-csrf-token', o.csrf).send(MP4)).status).toBe(400); // buffered route refuses videos
    expect((await request(app).post(`/api/v1/tenant/files/video?entityId=${l1.id}`).send(MP4)).status).toBe(401);
    expect(readdirSync(dir).flatMap((d) => readdirSync(path.join(dir, d))).length).toBe(before);
    expect((await o.agent.post(`/api/v1/tenant/files/video?entityId=${l1.id}`).set('content-type', 'application/octet-stream').send(MP4)).status).toBe(403); // no CSRF token
    const other = await tenantClient(app, 'vid2', 'learning'); expect((await vid(other, l1.id, MP4)).status).toBe(404);   // another tenant's lesson
    const emp = await employeeAgent(app, o, 'vid1'); expect((await vid(emp, l1.id, MP4)).status).toBeLessThan(500);
    // --- upload + attach
    const up = await vid(o, l1.id, MP4); expect(up.status).toBe(201); expect(up.body.data).toMatchObject({ mime: 'video/mp4', purpose: 'video', visibility: 'private' });
    expect((await o.patch('lesson', l1.id, { fileId: 'bogus' })).status).toBe(400);
    expect((await o.patch('lesson', l2.id, { fileId: up.body.data.id })).status).toBe(400);   // a file uploaded for a different lesson cannot be reused
    expect((await o.patch('lesson', l1.id, { fileId: up.body.data.id })).status).toBe(200);
    const doc = await o.agent.post(`/api/v1/tenant/files?purpose=education&entityType=lesson&entityId=${l2.id}`).set('x-csrf-token', o.csrf).set('x-file-name', 'notes.pdf').set('content-type', 'application/octet-stream').send(PDF); expect(doc.status).toBe(201);
    expect((await o.patch('lesson', l2.id, { fileId: doc.body.data.id })).status).toBe(200);
    const prev = await vid(o, l3.id, MP4); expect((await o.patch('lesson', l3.id, { fileId: prev.body.data.id })).status).toBe(200);
    // --- student: unpaid
    const s = (await o.create('student', { name: 'Sara', email: 'sara@x.com' })).body.data; const e = (await o.create('enrollment', { studentId: s.id, courseId: c.id })).body.data;
    const me = await student(app, 'vid1', 'sara@x.com'); const f = (lesson: string, h?: Record<string, string>) => me.get(`/enrollments/${e.id}/lessons/${lesson}/file`, h);
    expect((await f(l1.id)).status).toBe(409);                                   // payment required
    expect((await f(l3.id)).status).toBe(200);                                   // free preview lessons are open
    const view = await me.get(`/enrollments/${e.id}`); expect(view.body.data.lessons.find((x: { id: string }) => x.id === l1.id).file).toBeNull(); // metadata is hidden too
    // --- paid
    await o.create('payment', { enrollmentId: e.id, amount: 5000, method: 'cash' });
    expect((await o.get('enrollment', e.id)).body.data.data.paymentStatus).toBe('paid');
    const full = await f(l1.id); expect(full.status).toBe(200); expect(full.headers['content-type']).toBe('video/mp4'); expect(full.headers['accept-ranges']).toBe('bytes'); expect(full.headers['content-disposition']).toMatch(/^inline/);
    const part = await f(l1.id, { Range: 'bytes=10-19' }); expect(part.status).toBe(206); expect(part.headers['content-range']).toBe(`bytes 10-19/${MP4.length}`); expect(Number(part.headers['content-length'])).toBe(10);
    expect((await f(l1.id, { Range: `bytes=${MP4.length + 5}-` })).status).toBe(416);
    const dl = await f(l2.id); expect(dl.status).toBe(200); expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect((await me.get(`/enrollments/${e.id}`)).body.data.lessons.find((x: { id: string }) => x.id === l2.id).file).toMatchObject({ name: 'notes.pdf', mime: 'application/pdf' });
    // --- another student cannot reach this enrolment's files
    await o.create('student', { name: 'Omar', email: 'omar@x.com' }); const him = await student(app, 'vid1', 'omar@x.com');
    expect((await him.get(`/enrollments/${e.id}/lessons/${l1.id}/file`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/public/portal/learning/enrollments/${e.id}/lessons/${l1.id}/file`).set('Host', host('vid1'))).status).toBe(401);
  });
});
