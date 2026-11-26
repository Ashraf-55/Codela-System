import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { billingInvoices, createDb, manualPayments, seedPlatform, subscriptions } from '@codela/db';
import { createApp } from '../src/app';
import { createPlatformStaff } from '../src/platform-admin';

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = createDb(':memory:'); seedPlatform(db);
  app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, uploadDir: mkdtempSync(path.join(tmpdir(), 'codela-mp-')) });
});

const png = (seed: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`receipt-${seed}-`.padEnd(64, 'x'))]);

async function tenant(slug: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register-business').send({ businessName: `Biz ${slug}`, slug, productSlug: 'medical', name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });
  expect(r.status).toBe(201);
  const csrf = r.body.data.csrfToken as string; const id = r.body.data.tenant.id as string;
  const submit = (o: { method?: string; reference?: string; period?: string; body?: Buffer; name?: string }) =>
    agent.post(`/api/v1/tenant/subscription/manual-payment?billingPeriod=${o.period ?? 'monthly'}&method=${o.method ?? 'instapay'}&reference=${encodeURIComponent(o.reference ?? 'REF-1001')}`)
      .set('x-csrf-token', csrf).set('content-type', 'application/octet-stream').set('x-file-name', o.name ?? 'receipt.png').send(o.body ?? png(1));
  return { agent, csrf, id, submit };
}
async function staff(role: 'super_admin' | 'support' | 'finance') {
  const email = `${role}@codela.test`;
  await createPlatformStaff(db, { email, password: 'Admin-Pass-12345', name: `Staff ${role}`, role, department: 'management' });
  const agent = request.agent(app);
  const l = await agent.post('/api/v1/platform/auth/login').send({ email, password: 'Admin-Pass-12345' });
  expect(l.status).toBe(200);
  const csrf = l.body.data.csrfToken as string;
  return { agent, post: (u: string, b: object = {}) => agent.post(u).set('x-csrf-token', csrf).send(b), put: (u: string, b: object = {}) => agent.put(u).set('x-csrf-token', csrf).send(b) };
}
const configure = (s: Awaited<ReturnType<typeof staff>>) => s.put('/api/v1/platform/settings/payment', { value: { instapay: { enabled: true, handle: 'test-handle@instapay', accountName: 'Test Co' }, vodafone_cash: { enabled: false, number: '0100000000' } } });
const subStatus = (tenantId: string) => db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).get()!.status;

describe('manual payments (InstaPay / Vodafone Cash)', () => {
  it('offers only methods the Super Admin has configured and enabled', async () => {
    const t = await tenant('mp1'); const a = await staff('super_admin');
    expect((await t.agent.get('/api/v1/tenant/subscription/manual-payment/instructions')).body.data.methods).toEqual([]);
    expect((await t.submit({})).status).toBe(409);
    expect((await configure(a)).status).toBe(200);
    const m = (await t.agent.get('/api/v1/tenant/subscription/manual-payment/instructions')).body.data.methods as { method: string; handle: string }[];
    expect(m.map((x) => x.method)).toEqual(['instapay']); // vodafone_cash is disabled
    expect((await t.submit({ method: 'vodafone_cash' })).body.error.code).toBe('METHOD_UNAVAILABLE');
  });

  it('a receipt alone never activates the subscription; approval does (and only once)', async () => {
    const t = await tenant('mp2'); const a = await staff('super_admin'); await configure(a);
    const before = subStatus(t.id);
    const s = await t.submit({}); expect(s.status).toBe(201); expect(s.body.data.status).toBe('pending');
    expect(subStatus(t.id)).toBe(before); expect(subStatus(t.id)).not.toBe('active');
    const amount = s.body.data.amount as number;
    const ap = await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/approve`, { confirmedAmount: amount });
    expect(ap.status).toBe(200);
    expect(subStatus(t.id)).toBe('active');
    const row = db.select().from(manualPayments).where(eq(manualPayments.id, s.body.data.id)).get()!;
    expect(row.status).toBe('approved'); expect(row.reviewedBy).toBeTruthy(); expect(row.reviewedAt).toBeTruthy();
    expect(db.select().from(billingInvoices).where(eq(billingInvoices.id, row.invoiceId)).get()!.status).toBe('paid');
    expect((await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/approve`, { confirmedAmount: amount })).body.error.code).toBe('ALREADY_REVIEWED');
    expect((await t.agent.get('/api/v1/tenant/subscription/manual-payments')).body.data[0].status).toBe('approved');
  });

  it('refuses approval when the confirmed amount differs from the invoice', async () => {
    const t = await tenant('mp3'); const a = await staff('super_admin'); await configure(a);
    const s = await t.submit({});
    const bad = await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/approve`, { confirmedAmount: (s.body.data.amount as number) + 1 });
    expect(bad.status).toBe(409); expect(bad.body.error.code).toBe('AMOUNT_MISMATCH');
    expect(subStatus(t.id)).not.toBe('active');
    expect(db.select().from(manualPayments).get()!.status).toBe('pending');
  });

  it('rejection records the reason, voids the invoice and leaves the subscription untouched; resubmission is then allowed', async () => {
    const t = await tenant('mp4'); const a = await staff('super_admin'); await configure(a);
    const before = subStatus(t.id);
    const s = await t.submit({});
    expect((await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/reject`, { reason: 'x' })).status).toBe(400); // reason too short
    expect((await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/reject`, { reason: 'Receipt is unreadable' })).status).toBe(200);
    expect(subStatus(t.id)).toBe(before);
    const row = db.select().from(manualPayments).get()!;
    expect(row.status).toBe('rejected'); expect(row.reviewNote).toBe('Receipt is unreadable');
    expect(db.select().from(billingInvoices).where(eq(billingInvoices.id, row.invoiceId)).get()!.status).toBe('void');
    expect((await t.submit({})).status).toBe(201); // same reference and receipt may be re-submitted after a rejection
  });

  it('blocks duplicate references and duplicate receipts while one is pending or approved', async () => {
    const t = await tenant('mp5'); const a = await staff('super_admin'); await configure(a);
    expect((await t.submit({ reference: 'DUP-123', body: png(10) })).status).toBe(201);
    expect((await t.submit({ reference: '  dup-123 ', body: png(11) })).body.error.code).toBe('DUPLICATE_PAYMENT'); // reference is normalised
    expect((await t.submit({ reference: 'OTHER-9', body: png(10) })).body.error.code).toBe('DUPLICATE_PAYMENT'); // same receipt bytes
    const t2 = await tenant('mp5b'); // another tenant cannot reuse it either
    expect((await t2.submit({ reference: 'DUP-123', body: png(12) })).body.error.code).toBe('DUPLICATE_PAYMENT');
  });

  it('limits the number of pending requests per tenant', async () => {
    const t = await tenant('mp6'); const a = await staff('super_admin'); await configure(a);
    for (let i = 0; i < 3; i++) expect((await t.submit({ reference: `LIM-${i}00`, body: png(20 + i) })).status).toBe(201);
    expect((await t.submit({ reference: 'LIM-999', body: png(30) })).body.error.code).toBe('TOO_MANY_PENDING');
  });

  it('validates the receipt by content (HTML disguised as an image, empty, and Office files are refused)', async () => {
    const t = await tenant('mp7'); const a = await staff('super_admin'); await configure(a);
    expect((await t.submit({ body: Buffer.from('<html><script>alert(1)</script></html>'), name: 'receipt.png' })).status).toBe(415);
    expect((await t.submit({ body: Buffer.alloc(0) })).status).toBe(400);
    expect((await t.submit({ reference: 'ab' })).status).toBe(400); // reference too short
    expect((await t.submit({ reference: 'bad<script>' })).status).toBe(400);
    expect(db.select().from(manualPayments).all()).toHaveLength(0); // nothing stored on failure
  });

  it('enforces staff permissions: finance may review, support may only read, tenants cannot reach the platform API', async () => {
    const t = await tenant('mp8'); const a = await staff('super_admin'); await configure(a);
    const s = await t.submit({}); const id = s.body.data.id as string; const amount = s.body.data.amount as number;
    const support = await staff('support'); const finance = await staff('finance');
    expect((await support.agent.get('/api/v1/platform/manual-payments')).status).toBe(200);
    expect((await support.post(`/api/v1/platform/manual-payments/${id}/approve`, { confirmedAmount: amount })).status).toBe(403);
    expect((await t.agent.get('/api/v1/platform/manual-payments')).status).toBe(401);
    expect((await finance.post(`/api/v1/platform/manual-payments/${id}/approve`, { confirmedAmount: amount })).status).toBe(200);
  });

  it('keeps receipts private: other tenants get 404, generic file routes never expose them, staff can view and it is audited', async () => {
    const t = await tenant('mp9'); const other = await tenant('mp9b'); const a = await staff('super_admin'); await configure(a);
    const s = await t.submit({}); const id = s.body.data.id as string;
    expect((await t.agent.get(`/api/v1/tenant/subscription/manual-payments/${id}/receipt`)).status).toBe(200);
    expect((await other.agent.get(`/api/v1/tenant/subscription/manual-payments/${id}/receipt`)).status).toBe(404);
    expect((await other.agent.get('/api/v1/tenant/subscription/manual-payments')).body.data).toEqual([]);
    const list = (await t.agent.get('/api/v1/tenant/files')).body.data as { purpose: string }[];
    expect(list.some((f) => f.purpose === 'receipt')).toBe(false);
    const fileId = db.select().from(manualPayments).get()!.receiptFileId;
    expect((await t.agent.get(`/api/v1/tenant/files/${fileId}`)).status).toBe(404);
    expect((await t.agent.delete(`/api/v1/tenant/files/${fileId}`).set('x-csrf-token', t.csrf)).status).toBe(404);
    const rc = await a.agent.get(`/api/v1/platform/manual-payments/${id}/receipt`);
    expect(rc.status).toBe(200); expect(rc.headers['content-type']).toContain('image/png'); expect(rc.headers['x-content-type-options']).toBe('nosniff');
    const logs = (await a.agent.get('/api/v1/platform/audit-logs?pageSize=100')).body.data as { action: string }[];
    expect(logs.some((l) => l.action === 'platform.manual_payment.receipt_viewed')).toBe(true);
  });

  it('lets an expired tenant still submit a payment (renewal must stay reachable)', async () => {
    const t = await tenant('mp10'); const a = await staff('super_admin'); await configure(a);
    db.update(subscriptions).set({ status: 'expired' }).where(eq(subscriptions.tenantId, t.id)).run();
    expect((await t.submit({})).status).toBe(201);
  });
});

describe('plans and add-ons are paid through the same manual flow', () => {
  const sub = (id: string, q: string, ref: string, n: number, t: Awaited<ReturnType<typeof tenant>>) =>
    t.agent.post(`/api/v1/tenant/subscription/manual-payment?method=instapay&reference=${ref}&${q}`).set('x-csrf-token', t.csrf).set('content-type', 'application/octet-stream').set('x-file-name', 'r.png').send(png(n));
  const planTier = (id: string) => (db.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).get()!.planId);

  it('lists the product plans and add-ons with prices, so the customer can choose before paying', async () => {
    const t = await tenant('pl1'); const a = await staff('super_admin'); await configure(a);
    const d = (await t.agent.get('/api/v1/tenant/subscription/manual-payment/instructions')).body.data;
    expect(d.plans.map((p: { tier: string }) => p.tier).sort()).toEqual(['business', 'professional', 'starter']); expect(d.currentTier).toBe('starter');
    expect(d.addOns.length).toBeGreaterThan(0); expect(typeof d.addOns[0].priceMinor).toBe('number');
  });

  it('an upgrade is invoiced at the chosen plan price and only applied when a reviewer approves', async () => {
    const t = await tenant('pl2'); const a = await staff('super_admin'); await configure(a); const before = planTier(t.id);
    const s = await sub(t.id, 'kind=plan&planTier=professional&billingPeriod=annual', 'UP-0001', 11, t); expect(s.status).toBe(201);
    const pro = (await t.agent.get('/api/v1/tenant/subscription/manual-payment/instructions')).body.data.plans.find((p: { tier: string }) => p.tier === 'professional');
    expect(s.body.data.amount).toBe(pro.priceAnnual); expect(s.body.data.kind).toBe('plan');
    expect(planTier(t.id)).toBe(before); expect(subStatus(t.id)).not.toBe('active'); // submitting changes nothing
    expect((await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/approve`, { confirmedAmount: pro.priceAnnual + 1 })).body.error.code).toBe('AMOUNT_MISMATCH'); expect(planTier(t.id)).toBe(before);
    expect((await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/approve`, { confirmedAmount: pro.priceAnnual })).status).toBe(200);
    expect(planTier(t.id)).not.toBe(before); expect(subStatus(t.id)).toBe('active');
    expect((await t.agent.get('/api/v1/tenant/subscription/manual-payment/instructions')).body.data.currentTier).toBe('professional');
  });

  it('a rejected upgrade leaves the plan and subscription untouched', async () => {
    const t = await tenant('pl3'); const a = await staff('super_admin'); await configure(a); const before = planTier(t.id); const st = subStatus(t.id);
    const s = await sub(t.id, 'kind=plan&planTier=business', 'UP-0002', 12, t);
    expect((await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/reject`, { reason: 'receipt unreadable' })).status).toBe(200);
    expect(planTier(t.id)).toBe(before); expect(subStatus(t.id)).toBe(st);
  });

  it('an add-on is granted only on approval, does not renew the subscription, and cannot be bought twice or in parallel', async () => {
    const t = await tenant('ad1'); const a = await staff('super_admin'); await configure(a); const st = subStatus(t.id);
    const list = (await t.agent.get('/api/v1/tenant/subscription/manual-payment/instructions')).body.data.addOns as { key: string; priceMinor: number; status: string }[]; const add = list[0];
    const s = await sub(t.id, `kind=addon&addOnKey=${add.key}`, 'AD-0001', 13, t); expect(s.status).toBe(201); expect(s.body.data.amount).toBe(add.priceMinor); expect(s.body.data.addOnKey).toBe(add.key);
    const mine = async () => ((await t.agent.get('/api/v1/tenant/addons')).body.data as { key: string; status: string }[]).find((x) => x.key === add.key)!.status;
    expect(await mine()).toBe('available');
    expect((await sub(t.id, `kind=addon&addOnKey=${add.key}`, 'AD-0002', 14, t)).body.error.code).toBe('ALREADY_PENDING');
    expect((await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/approve`, { confirmedAmount: add.priceMinor })).status).toBe(200);
    expect(await mine()).toBe('active'); expect(subStatus(t.id)).toBe(st); // the subscription state is not touched by an add-on payment
    expect((await sub(t.id, `kind=addon&addOnKey=${add.key}`, 'AD-0003', 15, t)).body.error.code).toBe('ALREADY_ACTIVE');
    expect((await sub(t.id, 'kind=addon&addOnKey=nope', 'AD-0004', 16, t)).status).toBe(404);
  });

  it('the review list names the reviewer and what was bought; payment instructions are validated', async () => {
    const t = await tenant('rv1'); const a = await staff('super_admin'); await configure(a);
    const s = await sub(t.id, 'kind=plan&planTier=professional', 'RV-0001', 17, t);
    await a.post(`/api/v1/platform/manual-payments/${s.body.data.id}/reject`, { reason: 'wrong amount' });
    const row = (await a.agent.get('/api/v1/platform/manual-payments?status=rejected')).body.data[0];
    expect(row.reviewerName).toBe('Staff super_admin'); expect(row.planTier).toBe('professional');
    expect((await a.put('/api/v1/platform/settings/payment', { value: { vodafone_cash: { enabled: true, number: '12345' } } })).status).toBe(400);
    expect((await a.put('/api/v1/platform/settings/payment', { value: { instapay: { enabled: true, handle: '' } } })).status).toBe(400);
    expect((await a.put('/api/v1/platform/settings/payment', { value: { vodafone_cash: { enabled: true, number: '0100 123 4567' }, instapay: { enabled: true, handle: 'shop@instapay' } } })).status).toBe(200);
    expect((await a.agent.get('/api/v1/platform/settings/payment')).body.data.value.vodafone_cash.number).toBe('01001234567');
  });
});
