import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, notificationOutbox, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient } from './_helpers';

const PW = 'Str0ng-Pass!1';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
function build() {
  const db = createDb(':memory:'); seedPlatform(db); const uploadDir = mkdtempSync(path.join(tmpdir(), 'codela-av-'));
  const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', portalEmailVerification: false, uploadDir });
  return { db, app, uploadDir };
}
const host = (slug: string) => `${slug}.codela.test`;
async function customer(app: ReturnType<typeof createApp>, slug: string, email: string, name = 'Cust Omer') {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/public/portal/register').set('Host', host(slug)).send({ name, email, password: PW }); expect(r.status).toBe(201);
  const csrf = r.body.data.csrfToken as string; const u = (p: string) => `/api/v1/public/portal${p}`;
  return { agent, get: (p: string) => agent.get(u(p)).set('Host', host(slug)), del: (p: string) => agent.delete(u(p)).set('Host', host(slug)).set('x-csrf-token', csrf),
    put: (p: string, body: Buffer, name = 'me.png') => agent.put(u(p)).set('Host', host(slug)).set('x-csrf-token', csrf).set('content-type', 'application/octet-stream').set('x-file-name', name).send(body) };
}

describe('portal profile picture', () => {
  it('stores a validated image, serves it only to its owner, replaces and deletes it without leaving files behind', async () => {
    const { app, uploadDir } = build(); await tenantClient(app, 'avp', 'learning'); const c = await customer(app, 'avp', 'a@x.com'); const other = await customer(app, 'avp', 'b@x.com', 'Other Person');
    expect((await c.get('/avatar')).status).toBe(404);
    expect((await c.get('/me')).body.data.hasAvatar).toBe(false);
    expect((await c.put('/avatar', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png')).status).toBe(415);   // bytes decide, not the name
    expect((await c.put('/avatar', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]))).status).toBe(413);
    expect((await c.put('/avatar', PNG)).status).toBe(200);
    const img = await c.get('/avatar'); expect(img.status).toBe(200); expect(img.headers['content-type']).toContain('image/png'); expect(img.headers['x-content-type-options']).toBe('nosniff'); expect(img.headers['cache-control']).toContain('no-store');
    expect((await c.get('/me')).body.data.hasAvatar).toBe(true);
    expect((await other.get('/avatar')).status).toBe(404);                                // someone else's picture is invisible
    expect((await request(app).get('/api/v1/public/portal/avatar').set('Host', host('avp'))).status).toBe(401);
    const tenantDir = path.join(uploadDir, readdirSync(uploadDir)[0]);
    expect(readdirSync(tenantDir)).toHaveLength(1);
    expect((await c.put('/avatar', PNG)).status).toBe(200); expect(readdirSync(tenantDir)).toHaveLength(1);   // the old file was removed
    expect((await c.del('/avatar')).status).toBe(200); expect(readdirSync(tenantDir)).toHaveLength(0); expect((await c.get('/avatar')).status).toBe(404);
  });
  it('requires CSRF for changes', async () => {
    const { app } = build(); await tenantClient(app, 'avq', 'learning'); const c = await customer(app, 'avq', 'a@x.com');
    const r = await c.agent.put('/api/v1/public/portal/avatar').set('Host', host('avq')).set('content-type', 'application/octet-stream').send(PNG); expect(r.status).toBe(403);
  });
});

describe('staff profile picture', () => {
  it('owner uploads, reads and removes their own picture; another user cannot see it', async () => {
    const { app } = build(); const t = await tenantClient(app, 'sav', 'medical'); const t2 = await tenantClient(app, 'sav2', 'medical');
    expect((await t.agent.get('/api/v1/auth/me/avatar')).status).toBe(404);
    const put = (agent: typeof t.agent, csrf: string, body: Buffer) => agent.put('/api/v1/auth/me/avatar').set('x-csrf-token', csrf).set('content-type', 'application/octet-stream').set('x-file-name', 'me.png').send(body);
    expect((await put(t.agent, t.csrf, Buffer.from('not an image'))).status).toBe(415);
    expect((await put(t.agent, t.csrf, PNG)).status).toBe(200);
    expect((await t.agent.get('/api/v1/auth/me/avatar')).status).toBe(200);
    expect((await t2.agent.get('/api/v1/auth/me/avatar')).status).toBe(404);          // each user only ever gets their own picture
    expect((await request(app).get('/api/v1/auth/me/avatar')).status).toBe(401);
    expect((await t.agent.delete('/api/v1/auth/me/avatar').set('x-csrf-token', t.csrf)).status).toBe(200);
    expect((await t.agent.get('/api/v1/auth/me/avatar')).status).toBe(404);
  });
});

describe('portal notifications & payment history', () => {
  it('lists only customer-facing messages sent to this account, never links, and reports delivery honestly', async () => {
    const { app, db } = build(); const o = await tenantClient(app, 'ntf', 'learning'); const c = await customer(app, 'ntf', 'n@x.com'); const other = await customer(app, 'ntf', 'm@x.com', 'Other Person');
    const add = (to: string, template: string, status: string, payload: Record<string, unknown> = {}) => db.insert(notificationOutbox).values({ tenantId: o.tenantId, channel: 'email', toAddr: to, template, payload, status }).run();
    add('n@x.com', 'order_update', 'sent', { code: 'ORD-1', status: 'shipped' }); add('n@x.com', 'status_update', 'no_provider', { code: 'X-2', status: 'ready' });
    add('n@x.com', 'password_reset', 'sent', { link: 'https://secret/recover?reset=TOKEN' }); add('n@x.com', 'verify_email', 'sent', { link: 'https://secret/?verify=TOKEN' });
    add('m@x.com', 'order_update', 'sent', { code: 'OTHER-9', status: 'x' });
    const list = (await c.get('/notifications')).body.data as { template: string; delivery: string; subject: string }[];
    expect(list.map((n) => n.template).sort()).toEqual(['order_update', 'status_update']);
    expect(list.find((n) => n.template === 'order_update')!.delivery).toBe('sent'); expect(list.find((n) => n.template === 'status_update')!.delivery).toBe('not_delivered');
    expect(JSON.stringify(list)).not.toContain('TOKEN'); expect(JSON.stringify(list)).not.toContain('OTHER-9');
    expect((await other.get('/notifications')).body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/public/portal/notifications').set('Host', host('ntf'))).status).toBe(401);
  });

  it('shows what a student owes on their own enrolments only', async () => {
    const { app } = build(); const o = await tenantClient(app, 'pay', 'learning');
    const ins = (await o.create('instructor', { name: 'Dr X' })).body.data; const course = (await o.create('course', { title: 'Paid Course', instructorId: ins.id, price: 5000 })).body.data;
    await o.create('lesson', { courseId: course.id, title: 'L1', position: 1, durationMin: 10 }); await o.patch('course', course.id, { status: 'published' });
    const me = (await o.create('student', { name: 'Sara Student', email: 'sara@x.com' })).body.data; const other = (await o.create('student', { name: 'Other Student', email: 'other@x.com' })).body.data;
    await o.create('enrollment', { studentId: me.id, courseId: course.id }); await o.create('enrollment', { studentId: other.id, courseId: course.id });
    const c = await customer(app, 'pay', 'sara@x.com', 'Sara Student');
    const r = (await c.get('/payments')).body.data; expect(r.supported).toBe(true); expect(r.currency).toBeTruthy(); expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ total: 5000, paid: 0, balance: 5000, status: 'unpaid' });
    const none = await customer(app, 'pay', 'nobody@x.com', 'No Record'); expect((await none.get('/payments')).body.data.rows).toEqual([]);
  });
});
