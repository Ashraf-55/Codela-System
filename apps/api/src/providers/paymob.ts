import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../errors';

/**
 * Paymob "Accept" (classic) integration: auth token -> order registration -> payment key -> hosted iframe/redirect.
 * Documented flow: https://docs.paymob.com  (verify field names against your Paymob account before going live).
 * NOT verified against the live/sandbox API from the authoring environment (no network) — only the signature
 * maths and request shaping are unit-tested with an injected fetch. Needs real credentials, see docs/PAYMENTS.md.
 */
export interface PaymobConfig {
  apiKey: string; integrationId: number; iframeId: number; hmacSecret: string;
  baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}
export type Billing = { name: string; email: string; phone?: string };

// Fields concatenated (in this exact lexicographic order) to build the processed-callback HMAC (SHA-512).
export const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner',
  'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
] as const;

const dig = (o: any, p: string): unknown => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
export function hmacString(obj: Record<string, unknown>): string { return HMAC_FIELDS.map((f) => { const v = dig(obj, f); return v === undefined || v === null ? '' : String(v); }).join(''); }
export function computePaymobHmac(obj: Record<string, unknown>, secret: string): string { return createHmac('sha512', secret).update(hmacString(obj)).digest('hex'); }
export function verifyPaymobHmac(obj: Record<string, unknown>, received: string | undefined, secret: string): boolean {
  if (!secret || !received) return false;
  const a = Buffer.from(computePaymobHmac(obj, secret)), b = Buffer.from(String(received).toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function paymobConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaymobConfig | null {
  const { PAYMOB_API_KEY: apiKey, PAYMOB_INTEGRATION_ID: iid, PAYMOB_IFRAME_ID: fid, PAYMOB_HMAC_SECRET: hmacSecret } = env;
  if (!apiKey || !iid || !fid || !hmacSecret) return null;
  const integrationId = Number(iid), iframeId = Number(fid); if (!Number.isInteger(integrationId) || !Number.isInteger(iframeId)) return null;
  return { apiKey, integrationId, iframeId, hmacSecret, baseUrl: env.PAYMOB_BASE_URL };
}

export class PaymobClient {
  private f: typeof fetch; private base: string;
  constructor(private cfg: PaymobConfig) { this.f = cfg.fetchImpl ?? fetch; this.base = (cfg.baseUrl ?? 'https://accept.paymob.com').replace(/\/$/, ''); }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await this.f(`${this.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000) }).catch((e) => { throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', `Paymob unreachable: ${(e as Error).message}`); });
    if (!r.ok) throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', `Paymob ${path} responded ${r.status}`);
    return r.json() as Promise<T>;
  }
  async authToken(): Promise<string> { const j = await this.post<{ token?: string }>('/api/auth/tokens', { api_key: this.cfg.apiKey }); if (!j.token) throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Paymob auth failed'); return j.token; }
  /** Registers the order and returns {orderId, paymentUrl}. amountCents is the plan price in minor units (EGP: piasters). */
  async createCheckout(i: { amountCents: number; currency: string; merchantOrderId: string; billing: Billing }) {
    if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) throw new HttpError(400, 'BAD_REQUEST', 'Invalid amount');
    const token = await this.authToken();
    const order = await this.post<{ id?: number }>('/api/ecommerce/orders', { auth_token: token, delivery_needed: false, amount_cents: i.amountCents, currency: i.currency, merchant_order_id: i.merchantOrderId, items: [] });
    if (!order.id) throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Paymob order registration failed');
    const [first, ...rest] = i.billing.name.trim().split(/\s+/);
    const key = await this.post<{ token?: string }>('/api/acceptance/payment_keys', {
      auth_token: token, amount_cents: i.amountCents, expiration: 3600, order_id: order.id, currency: i.currency, integration_id: this.cfg.integrationId,
      billing_data: { first_name: first || 'NA', last_name: rest.join(' ') || 'NA', email: i.billing.email, phone_number: i.billing.phone || 'NA', apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', shipping_method: 'NA', postal_code: 'NA', city: 'NA', country: 'EG', state: 'NA' },
    });
    if (!key.token) throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Paymob payment key failed');
    return { orderId: String(order.id), paymentUrl: `${this.base}/api/acceptance/iframes/${this.cfg.iframeId}?payment_token=${encodeURIComponent(key.token)}` };
  }
  /** Server-to-server re-check of a transaction (never trust the browser redirect). Returns Paymob's own record. */
  async retrieveTransaction(txId: string | number): Promise<Record<string, any>> {
    const token = await this.authToken();
    const r = await this.f(`${this.base}/api/acceptance/transactions/${encodeURIComponent(String(txId))}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000) }).catch((e) => { throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', `Paymob unreachable: ${(e as Error).message}`); });
    if (!r.ok) throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', `Paymob transaction lookup responded ${r.status}`);
    return r.json() as Promise<Record<string, any>>;
  }
  /** Refund a captured transaction (full or partial). Amount in minor units. */
  async refund(transactionId: string | number, amountCents: number) {
    const token = await this.authToken();
    return this.post<Record<string, any>>('/api/acceptance/void_refund/refund', { auth_token: token, transaction_id: transactionId, amount_cents: amountCents });
  }
}

export type ParsedPaymobEvent = { kind: 'succeeded' | 'failed' | 'refunded' | 'ignored'; eventId: string; orderId: string; amountCents: number; currency: string };
/** Verifies the HMAC (query `hmac`) over the callback `obj` and classifies it. Returns null when the signature is invalid/malformed. */
export function parsePaymobCallback(rawBody: Buffer, query: Record<string, unknown>, secret: string): ParsedPaymobEvent | null {
  let j: any; try { j = JSON.parse(rawBody.toString('utf8')); } catch { return null; }
  const obj = j?.obj; if (!obj || typeof obj !== 'object') return null;
  if (!verifyPaymobHmac(obj, typeof query.hmac === 'string' ? query.hmac : undefined, secret)) return null;
  const orderId = String(obj.order?.id ?? ''); if (!orderId || obj.id == null) return null;
  const kind = obj.is_refunded === true ? 'refunded' : obj.is_voided === true ? 'ignored' : obj.pending === true ? 'ignored' : obj.success === true ? 'succeeded' : 'failed';
  return { kind, eventId: `${obj.id}:${kind}`, orderId, amountCents: Number(obj.amount_cents), currency: String(obj.currency ?? '') };
}
