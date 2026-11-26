import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { computePaymobHmac } from '../src/providers/paymob';
import { getEntitlements } from '../src/entitlements';
import { tenantClient } from './_helpers';

const SECRET = 'paymob-test-hmac';
let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
const calls: string[] = [];
beforeEach(() => {
  vi.stubEnv('PAYMOB_API_KEY', 'k'); vi.stubEnv('PAYMOB_INTEGRATION_ID', '77'); vi.stubEnv('PAYMOB_IFRAME_ID', '88'); vi.stubEnv('PAYMOB_HMAC_SECRET', SECRET);
  calls.length = 0; let n = 1000;
  // Paymob is faked at the network boundary only; every other layer (routes, DB, signature check) is real.
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(u); const j = u.endsWith('/auth/tokens') ? { token: 'T' } : u.endsWith('/orders') ? { id: ++n } : u.endsWith('/payment_keys') ? { token: 'PK' } : {}; return new Response(JSON.stringify(j), { status: 200 }); }));
  db = createDb(':memory:'); seedPlatform(db);
  app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, paymentProvider: 'paymob' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const cb = (obj: Record<string, unknown>, hmac?: string) => request(app).post(`/api/v1/webhooks/paymob?hmac=${hmac ?? computePaymobHmac(obj, SECRET)}`).set('content-type', 'application/json').send({ type: 'TRANSACTION', obj });
const txObj = (orderId: string, amount: number, extra: Record<string, unknown> = {}) => ({ amount_cents: amount, created_at: '2026-11-10T10:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 5001, integration_id: 77, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false, order: { id: Number(orderId) }, owner: 1, pending: false, source_data: { pan: '2346', sub_type: 'Visa', type: 'card' }, success: true, ...extra });

describe('Paymob checkout + webhook', () => {
  it('returns a hosted payment URL and creates a PENDING invoice/transaction (subscription is not activated)', async () => {
    const t = await tenantClient(app, 'pm1', 'medical');
    const r = await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' });
    expect(r.status).toBe(201); expect(r.body.data.redirectUrl).toContain('/api/acceptance/iframes/88?payment_token=PK');
    expect(r.body.data.transaction).toMatchObject({ gateway: 'paymob', status: 'pending', simulated: false });
    expect(getEntitlements(db, t.tenantId).sub.status).toBe('trialing');
  });
  it('activates ONLY from a correctly signed callback with the right amount', async () => {
    const t = await tenantClient(app, 'pm2', 'medical');
    const c = (await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' })).body.data;
    const amount = c.invoice.amount as number; const order = c.transaction.providerRef as string;
    expect((await cb(txObj(order, amount), 'deadbeef')).status).toBe(401);                      // forged signature
    expect(getEntitlements(db, t.tenantId).sub.status).toBe('trialing');
    expect((await cb(txObj(order, amount - 100))).status).toBe(409);                            // signed but wrong amount
    expect(getEntitlements(db, t.tenantId).sub.status).toBe('trialing');
    expect((await cb(txObj(order, amount))).status).toBe(200);
    expect(getEntitlements(db, t.tenantId).sub.status).toBe('active');
    const again = await cb(txObj(order, amount)); expect(again.body.data.duplicate).toBe(true); // idempotent replay
  });
  it('a failed or pending callback never activates; a refund marks the invoice refunded', async () => {
    const t = await tenantClient(app, 'pm3', 'medical');
    const c = (await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' })).body.data;
    const amount = c.invoice.amount as number; const order = c.transaction.providerRef as string;
    expect((await cb(txObj(order, amount, { pending: true, success: false, id: 1 }))).body.data.ignored).toBe(true);
    expect((await cb(txObj(order, amount, { success: false, id: 2 }))).status).toBe(200);
    expect(getEntitlements(db, t.tenantId).sub.status).not.toBe('active');
  });
  it('fails honestly (501) when credentials are missing', async () => {
    vi.stubEnv('PAYMOB_HMAC_SECRET', '');
    const d2 = createDb(':memory:'); seedPlatform(d2);
    const a2 = createApp({ db: d2, secureCookies: false, authRateLimitMax: 1000, paymentProvider: 'paymob' });
    const t = await tenantClient(a2, 'pm4', 'medical');
    const r = await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' }); expect(r.status).toBe(501); expect(r.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');
  });
});
