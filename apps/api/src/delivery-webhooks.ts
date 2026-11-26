import express, { Router } from 'express';
import { eq } from 'drizzle-orm';
import { notificationOutbox, type Db } from '@codela/db';
import { mapResendEvent, mapTwilioStatus, nextDeliveryStatus, verifyMeta, verifySvix, verifyTwilio } from './delivery-signatures';

/** Applies a provider delivery receipt to the outbox row that carries the provider's message id. Unknown ids are ignored (200) so providers stop retrying. */
export function applyDeliveryStatus(db: Db, providerId: string, incoming: 'sent' | 'delivered' | 'read' | 'failed', error?: string): boolean {
  const row = db.select().from(notificationOutbox).where(eq(notificationOutbox.providerId, providerId)).get(); if (!row) return false;
  const status = nextDeliveryStatus(row.status, incoming);
  if (status !== row.status || (incoming === 'failed' && error)) db.update(notificationOutbox).set({ status, lastError: incoming === 'failed' && error ? error.slice(0, 300) : row.lastError }).where(eq(notificationOutbox.id, row.id)).run();
  return true;
}

/**
 * Delivery receipts. Configure at the providers:
 *  - Twilio:   status callback  https://<api>/api/v1/webhooks/twilio-status   (sent automatically when PUBLIC_API_URL is set; signature checked with TWILIO_AUTH_TOKEN)
 *  - WhatsApp: callback URL     https://<api>/api/v1/webhooks/whatsapp         (verify token = WHATSAPP_VERIFY_TOKEN; payload signature checked with WHATSAPP_APP_SECRET)
 *  - E-mail (Resend): webhook   https://<api>/api/v1/webhooks/resend          (events email.sent / delivered / bounced / complained; signing secret in RESEND_WEBHOOK_SECRET, verified as Svix)
 * Not verified against the live services (no credentials in the authoring environment).
 */
export function deliveryWebhooks(db: Db, env: NodeJS.ProcessEnv = process.env) {
  const r = Router();
  r.post('/twilio-status', express.urlencoded({ extended: false, limit: '20kb' }), (req, res) => {
    const params = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)]));
    const base = (env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    if (!base || !verifyTwilio(env.TWILIO_AUTH_TOKEN ?? '', `${base}/api/v1/webhooks/twilio-status`, params, req.get('x-twilio-signature'))) return void res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
    const st = mapTwilioStatus(params.MessageStatus ?? ''); if (st && params.MessageSid) applyDeliveryStatus(db, params.MessageSid, st, params.ErrorCode ? `Twilio error ${params.ErrorCode}` : undefined);
    res.json({ data: { ok: true } });
  });
  r.post('/resend', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySvix(env.RESEND_WEBHOOK_SECRET ?? '', raw, { id: req.get('svix-id'), timestamp: req.get('svix-timestamp'), signature: req.get('svix-signature') })) return void res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
    let body: any; try { body = JSON.parse(raw.toString('utf8')); } catch { return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } }); }
    const m = typeof body?.type === 'string' ? mapResendEvent(body.type) : null; const id = body?.data?.email_id;
    if (m && typeof id === 'string') applyDeliveryStatus(db, id, m.status, m.error);
    res.json({ data: { ok: true } });
  });
  r.get('/whatsapp', (req, res) => {
    const token = env.WHATSAPP_VERIFY_TOKEN;
    if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) return void res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Verification failed' } });
  });
  r.post('/whatsapp', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyMeta(env.WHATSAPP_APP_SECRET ?? '', raw, req.get('x-hub-signature-256'))) return void res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
    let body: any; try { body = JSON.parse(raw.toString('utf8')); } catch { return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } }); }
    for (const entry of body?.entry ?? []) for (const ch of entry?.changes ?? []) for (const s of ch?.value?.statuses ?? []) {
      if (typeof s?.id === 'string' && ['sent', 'delivered', 'read', 'failed'].includes(s.status)) applyDeliveryStatus(db, s.id, s.status, s.status === 'failed' ? String(s.errors?.[0]?.title ?? 'WhatsApp delivery failed') : undefined);
    }
    res.json({ data: { ok: true } });
  });
  return r;
}
