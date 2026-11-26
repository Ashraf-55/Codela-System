import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createDb, notificationOutbox, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { enqueue, dispatchQueued } from '../src/outbox';
import { metaSignature, svixSignature, twilioSignature } from '../src/delivery-signatures';
import { tenantClient } from './_helpers';

const ENV = { PUBLIC_API_URL: 'https://api.example.com', TWILIO_AUTH_TOKEN: 'tok', WHATSAPP_APP_SECRET: 'appsecret', WHATSAPP_VERIFY_TOKEN: 'verify-me' };
function build() {
  Object.assign(process.env, ENV);
  const db = createDb(':memory:'); seedPlatform(db); return { db, app: createApp({ db, secureCookies: false, authRateLimitMax: 1000, providers: { email: { send: async () => ({ id: 'msg_1' }) } } }) };
}

describe('delivery tracking', () => {
  it('stores the provider message id on send', async () => {
    const { db, app } = build(); const t = await tenantClient(app, 'dlv', 'medical');
    enqueue(db, t.tenantId, 'email', 'a@b.co', 'status_update', { code: 'X' }); await dispatchQueued(db, { email: { send: async () => ({ id: 'msg_1' }) } }, t.tenantId);
    const row = db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.tenantId)).get()!; expect(row).toMatchObject({ status: 'sent', providerId: 'msg_1' });
  });
  it('Twilio callback: signature required; delivered moves forward and cannot be downgraded', async () => {
    const { db, app } = build(); const t = await tenantClient(app, 'dtw', 'medical');
    db.insert(notificationOutbox).values({ tenantId: t.tenantId, channel: 'sms', toAddr: '+201000000000', template: 'status_update', payload: {}, status: 'sent', providerId: 'SM1' }).run();
    const url = 'https://api.example.com/api/v1/webhooks/twilio-status'; const params = { MessageSid: 'SM1', MessageStatus: 'delivered' };
    expect((await request(app).post('/api/v1/webhooks/twilio-status').type('form').send(params)).status).toBe(401);
    expect((await request(app).post('/api/v1/webhooks/twilio-status').set('x-twilio-signature', twilioSignature('tok', url, params)).type('form').send(params)).status).toBe(200);
    const st = () => db.select().from(notificationOutbox).where(eq(notificationOutbox.providerId, 'SM1')).get()!.status; expect(st()).toBe('delivered');
    const late = { MessageSid: 'SM1', MessageStatus: 'sent' }; await request(app).post('/api/v1/webhooks/twilio-status').set('x-twilio-signature', twilioSignature('tok', url, late)).type('form').send(late); expect(st()).toBe('delivered');
  });
  it('WhatsApp callback: verify handshake, signed statuses update the row, bad signature rejected', async () => {
    const { db, app } = build(); const t = await tenantClient(app, 'dwa', 'medical');
    db.insert(notificationOutbox).values({ tenantId: t.tenantId, channel: 'whatsapp', toAddr: '201000000000', template: 'status_update', payload: {}, status: 'sent', providerId: 'wamid.1' }).run();
    expect((await request(app).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1234')).text).toBe('1234');
    expect((await request(app).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1234')).status).toBe(403);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] });
    expect((await request(app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=00').send(body)).status).toBe(401);
    expect((await request(app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', metaSignature('appsecret', Buffer.from(body))).send(body)).status).toBe(200);
    expect(db.select().from(notificationOutbox).where(eq(notificationOutbox.providerId, 'wamid.1')).get()!.status).toBe('read');
  });
});

describe('Resend (e-mail) delivery receipts', () => {
  const SECRET = `whsec_${Buffer.from('resend-signing-secret').toString('base64')}`;
  const send = (app: ReturnType<typeof createApp>, body: object, o: { secret?: string; ts?: number; id?: string } = {}) => {
    const raw = Buffer.from(JSON.stringify(body)); const id = o.id ?? 'msg_evt_1'; const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    return request(app).post('/api/v1/webhooks/resend').set('content-type', 'application/json').set('svix-id', id).set('svix-timestamp', ts).set('svix-signature', `v1,${svixSignature(o.secret ?? SECRET, id, ts, raw)}`).send(raw.toString('utf8')); // string, not Buffer: superagent JSON-serialises a Buffer and the signed bytes would no longer match
  };
  it('requires a valid, fresh Svix signature; delivered/bounced update the outbox and never downgrade', async () => {
    Object.assign(process.env, { RESEND_WEBHOOK_SECRET: SECRET }); const { db, app } = build(); const t = await tenantClient(app, 'drs', 'medical');
    db.insert(notificationOutbox).values({ tenantId: t.tenantId, channel: 'email', toAddr: 'a@b.co', template: 'status_update', payload: {}, status: 'sent', providerId: 'em_1' }).run();
    const st = () => db.select().from(notificationOutbox).where(eq(notificationOutbox.providerId, 'em_1')).get()!;
    expect((await request(app).post('/api/v1/webhooks/resend').send({ type: 'email.delivered', data: { email_id: 'em_1' } })).status).toBe(401);                       // unsigned
    expect((await send(app, { type: 'email.delivered', data: { email_id: 'em_1' } }, { secret: `whsec_${Buffer.from('other').toString('base64')}` })).status).toBe(401); // wrong secret
    expect((await send(app, { type: 'email.delivered', data: { email_id: 'em_1' } }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);                  // replayed / stale
    expect(st().status).toBe('sent');
    expect((await send(app, { type: 'email.delivered', data: { email_id: 'em_1' } })).status).toBe(200); expect(st().status).toBe('delivered');
    expect((await send(app, { type: 'email.bounced', data: { email_id: 'em_1' } })).status).toBe(200); expect(st().status).toBe('delivered');   // a delivered message is never marked failed afterwards
    expect((await send(app, { type: 'email.delivered', data: { email_id: 'unknown' } })).status).toBe(200);                                         // unknown ids are acknowledged so Resend stops retrying
  });
  it('a bounce on a sent message is recorded with a reason; opens are ignored', async () => {
    Object.assign(process.env, { RESEND_WEBHOOK_SECRET: SECRET }); const { db, app } = build(); const t = await tenantClient(app, 'drb', 'medical');
    db.insert(notificationOutbox).values({ tenantId: t.tenantId, channel: 'email', toAddr: 'x@y.co', template: 'status_update', payload: {}, status: 'sent', providerId: 'em_2' }).run();
    await send(app, { type: 'email.opened', data: { email_id: 'em_2' } }); expect(db.select().from(notificationOutbox).where(eq(notificationOutbox.providerId, 'em_2')).get()!.status).toBe('sent');
    await send(app, { type: 'email.bounced', data: { email_id: 'em_2' } }, { id: 'msg_evt_2' }); expect(db.select().from(notificationOutbox).where(eq(notificationOutbox.providerId, 'em_2')).get()).toMatchObject({ status: 'failed', lastError: 'E-mail bounced' });
  });
});
