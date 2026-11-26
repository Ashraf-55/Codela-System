import { createHmac, timingSafeEqual } from 'node:crypto';

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Twilio: base64(HMAC-SHA1(authToken, url + sorted(key+value...))) — https://www.twilio.com/docs/usage/webhooks/webhooks-security */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}
export const verifyTwilio = (authToken: string, url: string, params: Record<string, string>, header: string | undefined) => !!authToken && !!header && same(twilioSignature(authToken, url, params), header);

/** Meta (WhatsApp Cloud API): X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, rawBody). */
export const metaSignature = (appSecret: string, raw: Buffer) => `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
export const verifyMeta = (appSecret: string, raw: Buffer, header: string | undefined) => !!appSecret && !!header && same(metaSignature(appSecret, raw), header);

/** Delivery states only move forward (sent < delivered < read); "failed" can replace sent/queued but never a delivered/read message. */
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
export function nextDeliveryStatus(current: string, incoming: 'sent' | 'delivered' | 'read' | 'failed'): string {
  if (incoming === 'failed') return current in RANK && RANK[current] >= 2 ? current : 'failed';
  if (!(current in RANK)) return current === 'failed' && incoming !== 'sent' ? incoming : current;
  return RANK[incoming] > RANK[current] ? incoming : current;
}
export const mapTwilioStatus = (s: string): 'sent' | 'delivered' | 'failed' | null => s === 'delivered' ? 'delivered' : s === 'sent' ? 'sent' : s === 'undelivered' || s === 'failed' ? 'failed' : null;

/**
 * Resend webhooks are signed with Svix: headers svix-id / svix-timestamp / svix-signature ("v1,<base64>" , space separated when rotating).
 * signature = base64(HMAC-SHA256(base64decode(secret without "whsec_"), `${id}.${timestamp}.${rawBody}`)); timestamps older than 5 minutes are rejected (replay protection).
 * https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 */
export function svixSignature(secret: string, id: string, timestamp: string, raw: Buffer): string {
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest('base64');
}
export function verifySvix(secret: string, raw: Buffer, h: { id?: string; timestamp?: string; signature?: string }, nowMs = Date.now()): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp); if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const want = svixSignature(secret, h.id, h.timestamp, raw);
  return h.signature.split(' ').some((part) => { const [v, sig] = part.split(','); return v === 'v1' && !!sig && same(want, sig); });
}
/** Resend event type -> outbox delivery state. Opens/clicks are deliberately ignored (no tracking pixels); delayed is not final. */
export const mapResendEvent = (t: string): { status: 'sent' | 'delivered' | 'failed'; error?: string } | null =>
  t === 'email.sent' ? { status: 'sent' } : t === 'email.delivered' ? { status: 'delivered' } : t === 'email.bounced' ? { status: 'failed', error: 'E-mail bounced' } : t === 'email.complained' ? { status: 'failed', error: 'Recipient marked the e-mail as spam' } : t === 'email.failed' ? { status: 'failed', error: 'E-mail failed to send' } : null;
