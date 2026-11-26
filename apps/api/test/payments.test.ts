import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient } from './_helpers';
import { createPlatformStaff } from '../src/platform-admin';

const SECRET = 'whsec_test_secret';
let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, paymentProvider: 'sandbox', webhookSecrets: { sandbox: SECRET } }); });
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');
const hook = (event: object, secret = SECRET) => { const raw = JSON.stringify(event); return request(app).post('/api/v1/webhooks/sandbox').set('content-type', 'application/json').set('x-signature', sign(raw, secret)).send(raw); };
const sub = async (t: Awaited<ReturnType<typeof tenantClient>>) => (await t.agent.get('/api/v1/tenant/subscription')).body.data;

describe('subscription checkout through the gateway boundary', () => {
  it('creates an invoice + pending transaction; confirmation activates the subscription exactly once; everything is flagged simulated', async () => {
    const t = await tenantClient(app, 'alpha', 'medical');
    const c = await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'annual' }); expect(c.status).toBe(201);
    expect(c.body.data.invoice).toMatchObject({ amount: 499000, currency: 'EGP', status: 'issued', number: expect.stringMatching(/^ALPHA-\d{4}$/) });
    expect(c.body.data.transaction).toMatchObject({ status: 'pending', simulated: true }); expect((await sub(t)).status).toBe('trialing'); // nothing activates before payment
    const id = c.body.data.transaction.id;
    const ok = await t.post(`/api/v1/tenant/subscription/checkout/${id}/sandbox-confirm`); expect(ok.status).toBe(200);
    const s = await sub(t); expect(s.status).toBe('active'); expect(s.billingPeriod).toBe('annual');
    const again = await t.post(`/api/v1/tenant/subscription/checkout/${id}/sandbox-confirm`); expect(again.status).toBe(200); // idempotent
    expect((await sub(t)).currentPeriodEnd).toBe(s.currentPeriodEnd);
    const inv = (await t.agent.get('/api/v1/tenant/billing/invoices')).body.data; expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ status: 'paid', transactions: [{ status: 'succeeded', simulated: true }] });
    expect((await t.agent.get('/api/v1/tenant/notifications')).body.data.some((n: { type: string }) => n.type === 'payment_succeeded')).toBe(true);
  });
  it('same Idempotency-Key returns the same transaction; invoices are tenant-isolated; needs subscription.manage', async () => {
    const a = await tenantClient(app, 'alpha', 'medical'); const b = await tenantClient(app, 'beta', 'medical');
    const one = await a.agent.post('/api/v1/tenant/subscription/checkout').set('x-csrf-token', a.csrf).set('idempotency-key', 'k-1').send({ billingPeriod: 'monthly' });
    const two = await a.agent.post('/api/v1/tenant/subscription/checkout').set('x-csrf-token', a.csrf).set('idempotency-key', 'k-1').send({ billingPeriod: 'monthly' });
    expect(two.body.data.transaction.id).toBe(one.body.data.transaction.id); expect((await a.agent.get('/api/v1/tenant/billing/invoices')).body.data).toHaveLength(1);
    expect((await b.agent.get('/api/v1/tenant/billing/invoices')).body.data).toEqual([]);
    expect((await b.post(`/api/v1/tenant/subscription/checkout/${one.body.data.transaction.id}/sandbox-confirm`)).status).toBe(404);
    await a.post('/api/v1/tenant/employees', { name: 'Emp', email: 'e@alpha.test', password: 'Emp-Pass-1234!', role: 'employee' });
    const e = request.agent(app); const l = await e.post('/api/v1/auth/login').send({ email: 'e@alpha.test', password: 'Emp-Pass-1234!' });
    expect((await e.post('/api/v1/tenant/subscription/checkout').set('x-csrf-token', l.body.data.csrfToken).send({ billingPeriod: 'monthly' })).status).toBe(403);
  });
  it('a provider that is not configured fails honestly instead of faking a payment', async () => {
    const live = createApp({ db, secureCookies: false, authRateLimitMax: 1000, paymentProvider: 'paymob' });
    const t = await tenantClient(live, 'gamma', 'medical');
    const r = await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' }); expect(r.status).toBe(501); expect(r.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');
    expect((await t.agent.get('/api/v1/tenant/billing/invoices')).body.data).toEqual([]); expect((await sub(t)).status).toBe('trialing');
    const none = createApp({ db, secureCookies: false, authRateLimitMax: 1000, paymentProvider: null }); // production-like: no provider selected
    expect((await (await tenantClient(none, 'delta', 'medical')).post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' })).status).toBe(501);
  });
});

describe('webhooks (signed, idempotent)', () => {
  async function pending() { const t = await tenantClient(app, 'alpha', 'medical'); const c = await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' }); return { t, tx: c.body.data.transaction as { id: string; providerRef: string } }; }
  it('rejects missing/invalid signatures and unknown providers', async () => {
    const { tx } = await pending(); const ev = { eventId: 'evt_1', type: 'payment.succeeded', providerRef: tx.providerRef };
    expect((await hook(ev, 'wrong-secret')).status).toBe(401);
    expect((await request(app).post('/api/v1/webhooks/sandbox').set('content-type', 'application/json').send(JSON.stringify(ev))).status).toBe(401);
    expect((await request(app).post('/api/v1/webhooks/nope').set('content-type', 'application/json').send('{}')).status).toBe(404);
    expect((await request(app).post('/api/v1/webhooks/paymob').set('content-type', 'application/json').send('{}')).status).toBe(501); // live verification not implemented => never trusted
  });
  it('a valid success event activates once; replays are acknowledged but change nothing', async () => {
    const { t, tx } = await pending(); const ev = { eventId: 'evt_1', type: 'payment.succeeded', providerRef: tx.providerRef };
    expect((await hook(ev)).status).toBe(200); const s1 = await sub(t); expect(s1.status).toBe('active');
    const replay = await hook(ev); expect(replay.status).toBe(200); expect(replay.body.data.duplicate).toBe(true); expect((await sub(t)).currentPeriodEnd).toBe(s1.currentPeriodEnd);
    expect((db.$client.prepare('select count(*) c from webhook_events').get() as { c: number }).c).toBe(1);
    expect((await hook({ eventId: 'evt_2', type: 'payment.succeeded', providerRef: tx.providerRef })).status).toBe(200); expect((await sub(t)).currentPeriodEnd).toBe(s1.currentPeriodEnd); // new event id, same transaction: still one activation
    expect((await hook({ eventId: 'evt_3', type: 'payment.succeeded', providerRef: 'unknown' })).status).toBe(404);
  });
  it('a failed payment moves an active subscription to past_due and notifies the business', async () => {
    const { t, tx } = await pending(); await t.post(`/api/v1/tenant/subscription/checkout/${tx.id}/sandbox-confirm`);
    const c2 = (await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' })).body.data.transaction;
    expect((await hook({ eventId: 'evt_f', type: 'payment.failed', providerRef: c2.providerRef })).status).toBe(200);
    expect((await sub(t)).status).toBe('past_due'); expect((await t.agent.get('/api/v1/tenant/notifications')).body.data.some((n: { type: string }) => n.type === 'payment_failed')).toBe(true);
    expect((await t.agent.get('/api/v1/tenant/billing/invoices')).body.data.find((i: { id: string }) => i.id === c2.invoiceId)?.transactions[0].status).toBe('failed');
  });
});

describe('revenue analytics from billing records', () => {
  it('separates real collections from simulated ones and counts failed payments', async () => {
    const t = await tenantClient(app, 'alpha', 'medical'); const c = (await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' })).body.data.transaction;
    await t.post(`/api/v1/tenant/subscription/checkout/${c.id}/sandbox-confirm`);
    const c2 = (await t.post('/api/v1/tenant/subscription/checkout', { billingPeriod: 'monthly' })).body.data.transaction; await hook({ eventId: 'e9', type: 'payment.failed', providerRef: c2.providerRef });
    await createPlatformStaff(db, { email: 'fin@codela.test', password: 'Admin-Pass-12345', name: 'Fin', role: 'finance', department: 'management' });
    const f = request.agent(app); await f.post('/api/v1/platform/auth/login').send({ email: 'fin@codela.test', password: 'Admin-Pass-12345' });
    const d = (await f.get('/api/v1/platform/analytics')).body.data;
    expect(d.collected.EGP).toEqual({ real: 0, simulated: 49900 }); expect(d.failedPayments).toBe(1); expect(d.outstandingInvoices).toBe(1); expect(d.simulated).toBe(true);
  });
});
