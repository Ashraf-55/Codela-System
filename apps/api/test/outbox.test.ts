import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient, type TC } from './_helpers';
import type { NotificationProvider } from '../src/outbox';

const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
function build(providers?: Record<string, NotificationProvider>) {
  const db = createDb(':memory:'); seedPlatform(db);
  return { db, app: createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', providers }) };
}
async function salon(app: ReturnType<typeof createApp>, slug = 'alpha') {
  const s = await tenantClient(app, slug, 'booking');
  const cat = (await s.create('serviceCategory', { name: 'Hair' })).body.data; const svc = (await s.create('service', { name: 'Cut', categoryId: cat.id, durationMin: 30, price: 10000 })).body.data;
  const st = (await s.create('staff', { name: 'Nora', skills: [{ serviceId: svc.id }] })).body.data; for (let d = 0; d < 7; d++) await s.create('schedule', { staffId: st.id, weekday: d, from: '09:00', to: '17:00' });
  return { s, svc };
}
const book = (app: ReturnType<typeof createApp>, svc: { id: string }, time = '10:00', host = 'alpha.codela.test') => request(app).post('/api/v1/public/actions/book').set('Host', host).send({ customer: { name: 'Dina', phone: '01001112223' }, serviceId: svc.id, date: dayOffset(3), startTime: time });
const outbox = async (s: TC) => (await s.agent.get('/api/v1/tenant/outbox')).body.data as { id: string; channel: string; toAddr: string; status: string; attempts: number; template: string }[];

describe('notification outbox (no fake deliveries)', () => {
  it('without a connected provider the message is recorded as no_provider — never "sent"', async () => {
    const { app } = build(); const { s, svc } = await salon(app); await s.post('/api/v1/tenant/addons/sms_notifications/activate');
    expect((await book(app, svc)).status).toBe(201); const o = await outbox(s); expect(o).toHaveLength(1); expect(o[0]).toMatchObject({ channel: 'sms', toAddr: '01001112223', template: 'booking_created', status: 'no_provider', attempts: 0 });
  });
  it('SMS/WhatsApp need the matching add-on entitlement', async () => {
    const sent: string[] = []; const { app } = build({ sms: { send: async (m) => { sent.push(m.to); } } }); const { s, svc } = await salon(app);
    await book(app, svc); expect((await outbox(s))[0].status).toBe('not_entitled'); expect(sent).toEqual([]);
  });
  it('a connected provider delivers; failures are retried up to the limit; isolation per tenant', async () => {
    const sent: { to: string; body: string }[] = []; let fail = 1;
    const { app } = build({ sms: { send: async (m) => { if (fail-- > 0) throw new Error('gateway timeout'); sent.push({ to: m.to, body: m.body }); } } });
    const { s, svc } = await salon(app); await s.post('/api/v1/tenant/addons/sms_notifications/activate');
    await book(app, svc); let o = await outbox(s); expect(o[0]).toMatchObject({ status: 'failed', attempts: 1 }); expect(sent).toEqual([]);
    const retry = await s.post(`/api/v1/tenant/outbox/${o[0].id}/retry`); expect(retry.status).toBe(200);
    o = await outbox(s); expect(o[0]).toMatchObject({ status: 'sent', attempts: 2 }); expect(sent[0].to).toBe('01001112223'); expect(sent[0].body).toContain('BK-0001');
    expect((await s.post(`/api/v1/tenant/outbox/${o[0].id}/retry`)).status).toBe(409); // already delivered
    const other = await tenantClient(app, 'beta', 'booking'); expect(await outbox(other)).toEqual([]); expect((await other.post(`/api/v1/tenant/outbox/${o[0].id}/retry`)).status).toBe(404);
  });
  it('gives up after 3 failed attempts', async () => {
    const { app } = build({ sms: { send: async () => { throw new Error('down'); } } }); const { s, svc } = await salon(app); await s.post('/api/v1/tenant/addons/sms_notifications/activate');
    await book(app, svc); const id = (await outbox(s))[0].id; await s.post(`/api/v1/tenant/outbox/${id}/retry`); await s.post(`/api/v1/tenant/outbox/${id}/retry`);
    const o = (await outbox(s))[0]; expect(o).toMatchObject({ status: 'failed', attempts: 3 }); expect((await s.post(`/api/v1/tenant/outbox/${id}/retry`)).status).toBe(409);
  });
});

describe('notification preferences', () => {
  it('opted-out kinds/channels are recorded as opted_out and never queued; account mails are unaffected', async () => {
    const { enqueue } = await import('../src/outbox'); const { notificationOutbox } = await import('@codela/db'); const { eq } = await import('drizzle-orm'); const { setup, tenantClient } = await import('./_helpers');
    const { db, app } = setup(); const t = await tenantClient(app, 'prf', 'medical');
    const r = await t.agent.patch('/api/v1/tenant/settings').set('x-csrf-token', t.csrf).send({ notifyPrefs: { reminders: false, sms: false } }); expect(r.status).toBe(200);
    enqueue(db, t.tenantId, 'email', 'a@b.co', 'appointment_reminder', {}); enqueue(db, t.tenantId, 'email', 'a@b.co', 'order_update', {}); enqueue(db, t.tenantId, 'sms', '+201001234567', 'order_update', {}); enqueue(db, t.tenantId, 'email', 'a@b.co', 'password_reset', {});
    const by = (tpl: string, ch: string) => db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.tenantId)).all().find((x) => x.template === tpl && x.channel === ch)!.status;
    expect(by('appointment_reminder', 'email')).toBe('opted_out'); expect(by('order_update', 'sms')).toBe('opted_out');
    expect(by('order_update', 'email')).toBe('queued'); expect(by('password_reset', 'email')).toBe('queued');
  });
});
