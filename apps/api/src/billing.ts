import express, { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { billingInvoices, paymentTransactions, plans, subscriptions, tenants, users, type Db } from '@codela/db';
import { applyEvent } from '@codela/shared';
import { z } from 'zod';
import { HttpError, notFound } from './errors';
import { GRACE_DAYS, getEntitlements, saveSub } from './entitlements';
import { notifyTenant } from './notify';
import { enqueue } from './outbox';
import { ownerEmail } from './owner';
import { requirePermission } from './auth';
import { sha256 } from './security';
import { PaymobClient, parsePaymobCallback, paymobConfigFromEnv, type PaymobConfig } from './providers/paymob';

/** Payment provider boundary. Real providers must verify their own webhooks; never trust a payload that was not verified. */
export interface PaymentGateway {
  name: string; simulated: boolean;
  initiate(req: { amount: number; currency: string; reference: string; description: string; contact?: { name: string; email: string; phone?: string } }): Promise<{ providerRef: string; redirectUrl?: string }>;
  /** Returns the verified event, or null when the signature is invalid. Throws HttpError(501) when the provider is not configured.
   *  `amount`/`currency` (minor units) are provider-reported and are checked against our stored transaction before anything is applied. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, query?: Record<string, unknown>): { eventId: string; type: WebhookType; providerRef: string; amount?: number; currency?: string } | null;
  /** Optional: refund a succeeded transaction at the provider (full amount, minor units). */
  refund?(providerRef: string, amount: number): Promise<void>;
}
export type WebhookType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'payment.ignored';
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Sandbox: no money moves. Webhooks are HMAC-SHA256 signed (header x-signature) with SANDBOX_WEBHOOK_SECRET so the full callback path can be exercised. */
export const sandboxGateway = (secret?: string): PaymentGateway => ({
  name: 'sandbox', simulated: true,
  initiate: async () => ({ providerRef: `sbx_${randomBytes(8).toString('hex')}` }),
  verifyWebhook(headers, raw) {
    if (!secret) throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', 'Webhook secret is not configured');
    const sig = String(headers['x-signature'] ?? ''); if (!sig || !safeEq(sig, createHmac('sha256', secret).update(raw).digest('hex'))) return null;
    try { const j = JSON.parse(raw.toString('utf8')); return z.object({ eventId: z.string().min(1), type: z.enum(['payment.succeeded', 'payment.failed']), providerRef: z.string().min(1) }).parse(j); } catch { return null; }
  },
});
/** Paymob Accept. Without PAYMOB_API_KEY / PAYMOB_INTEGRATION_ID / PAYMOB_IFRAME_ID / PAYMOB_HMAC_SECRET it fails honestly with 501 and stores nothing.
 *  The webhook is verified with Paymob's HMAC-SHA512 (query `hmac`); a subscription is only ever activated from a verified callback. */
export const paymobGateway = (cfg: PaymobConfig | null = paymobConfigFromEnv()): PaymentGateway => {
  const need = () => { if (!cfg) throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', 'Paymob credentials are not configured'); return cfg; };
  return {
    name: 'paymob', simulated: false,
    async initiate(r) {
      const c = need(); const out = await new PaymobClient(c).createCheckout({ amountCents: r.amount, currency: r.currency, merchantOrderId: r.reference.slice(0, 60), billing: r.contact ?? { name: 'Customer', email: 'noreply@codela.tech' } });
      return { providerRef: out.orderId, redirectUrl: out.paymentUrl };
    },
    verifyWebhook(_h, raw, query = {}) {
      const c = need(); const ev = parsePaymobCallback(raw, query, c.hmacSecret); if (!ev) return null;
      return { eventId: ev.eventId, providerRef: ev.orderId, amount: ev.amountCents, currency: ev.currency, type: ev.kind === 'succeeded' ? 'payment.succeeded' : ev.kind === 'failed' ? 'payment.failed' : ev.kind === 'refunded' ? 'payment.refunded' : 'payment.ignored' };
    },
  };
};

export type ProviderChoice = 'sandbox' | 'paymob' | null | undefined;
export function resolveGateways(choice: ProviderChoice, secrets: Record<string, string> = {}) {
  const env = process.env.PAYMENT_PROVIDER as 'sandbox' | 'paymob' | undefined;
  const active = choice === undefined ? env ?? (process.env.NODE_ENV !== 'production' ? 'sandbox' : null) : choice;
  const all: Record<string, PaymentGateway> = { sandbox: sandboxGateway(secrets.sandbox ?? process.env.SANDBOX_WEBHOOK_SECRET), paymob: paymobGateway() };
  return { active: active ? all[active] : null, all };
}

const pad = (n: number) => String(n).padStart(4, '0');
export function nextInvoiceNumber(db: Db, tenantId: string, slug: string) {
  const r = db.get(sql`insert into counters (tenant_id, key, value) values (${tenantId}, 'billing_invoice', 1) on conflict (tenant_id, key) do update set value = value + 1 returning value`) as { value: number };
  return `${slug.toUpperCase()}-${pad(r.value)}`;
}

export async function startCheckout(db: Db, gw: PaymentGateway, tenantId: string, billingPeriod: 'monthly' | 'annual', clientKey?: string, contact?: { name: string; email: string; phone?: string }) {
  const idem = `${tenantId}:${clientKey ?? randomBytes(12).toString('hex')}`;
  const existing = db.select().from(paymentTransactions).where(eq(paymentTransactions.idempotencyKey, idem)).get();
  if (existing) return { tx: existing, invoice: db.select().from(billingInvoices).where(eq(billingInvoices.id, existing.invoiceId)).get()!, replay: true };
  const e = getEntitlements(db, tenantId); const t = db.select().from(tenants).where(eq(tenants.id, tenantId)).get()!;
  const amount = billingPeriod === 'annual' ? e.plan.priceAnnual : e.plan.priceMonthly;
  const init = await gw.initiate({ amount, currency: e.plan.currency, reference: idem, description: `${e.plan.tier} ${billingPeriod}`, contact }); // may throw 501: nothing is stored then
  return db.transaction((tx) => {
    const now = new Date().toISOString(); const d = tx as unknown as Db;
    const invoice = d.insert(billingInvoices).values({ tenantId, number: nextInvoiceNumber(d, tenantId, t.slug), subscriptionId: e.subscriptionId, planId: e.plan.id, billingPeriod, description: `${e.plan.nameEn} — ${billingPeriod}`, amount, currency: e.plan.currency, issuedAt: now }).returning().get();
    const row = d.insert(paymentTransactions).values({ tenantId, invoiceId: invoice.id, gateway: gw.name, providerRef: init.providerRef, idempotencyKey: idem, amount, currency: e.plan.currency, simulated: gw.simulated }).returning().get();
    return { tx: row, invoice, replay: false, redirectUrl: init.redirectUrl };
  });
}

/** Idempotent: only a pending transaction changes state. */
export function applyPaymentResult(db: Db, txId: string, result: 'succeeded' | 'failed'): { changed: boolean } {
  return db.transaction((trx) => {
    const d = trx as unknown as Db; const row = d.select().from(paymentTransactions).where(eq(paymentTransactions.id, txId)).get();
    if (!row || row.status !== 'pending') return { changed: false };
    const now = new Date(); const inv = d.select().from(billingInvoices).where(eq(billingInvoices.id, row.invoiceId)).get()!;
    d.update(paymentTransactions).set({ status: result }).where(eq(paymentTransactions.id, row.id)).run();
    const e = getEntitlements(d, row.tenantId, now); const before = e.sub.status;
    if (result === 'succeeded') {
      d.update(billingInvoices).set({ status: 'paid', paidAt: now.toISOString() }).where(eq(billingInvoices.id, inv.id)).run();
      saveSub(d, e.subscriptionId, row.tenantId, applyEvent({ ...e.sub, billingPeriod: inv.billingPeriod as 'monthly' | 'annual' }, { type: 'payment_succeeded' }, now, GRACE_DAYS), 'payment_succeeded', before, { simulated: row.simulated, invoice: inv.number });
      notifyTenant(d, row.tenantId, 'payment_succeeded', 'Payment received', `Invoice ${inv.number} was paid.`);
      { const to = ownerEmail(d, row.tenantId); if (to && !row.simulated) enqueue(d, row.tenantId, 'email', to, 'payment_confirmation', { invoice: inv.number, amount: (row.amount / 100).toFixed(2), currency: row.currency }); }
    } else {
      if (before === 'active') saveSub(d, e.subscriptionId, row.tenantId, applyEvent(e.sub, { type: 'payment_failed' }, now, GRACE_DAYS), 'payment_failed', before, { simulated: row.simulated, invoice: inv.number });
      notifyTenant(d, row.tenantId, 'payment_failed', 'Payment failed', `Invoice ${inv.number} could not be charged.`);
      { const to = ownerEmail(d, row.tenantId); if (to && !row.simulated) enqueue(d, row.tenantId, 'email', to, 'subscription_notice', { messageEn: `Payment for invoice ${inv.number} failed. Please update your payment and retry.`, messageAr: `فشلت عملية الدفع للفاتورة ${inv.number}. يرجى المحاولة مرة أخرى.` }); }
    }
    return { changed: true };
  });
}

/** Idempotent: only a succeeded transaction can be refunded. The subscription is NOT auto-cancelled (an operator decision). */
export function applyRefund(db: Db, txId: string): { changed: boolean } {
  return db.transaction((trx) => {
    const d = trx as unknown as Db; const row = d.select().from(paymentTransactions).where(eq(paymentTransactions.id, txId)).get();
    if (!row || row.status !== 'succeeded') return { changed: false };
    d.update(paymentTransactions).set({ status: 'refunded' }).where(eq(paymentTransactions.id, row.id)).run();
    const inv = d.select().from(billingInvoices).where(eq(billingInvoices.id, row.invoiceId)).get()!;
    d.update(billingInvoices).set({ status: 'refunded' }).where(eq(billingInvoices.id, inv.id)).run();
    notifyTenant(d, row.tenantId, 'payment_refunded', 'Payment refunded', `Invoice ${inv.number} was refunded.`);
    return { changed: true };
  });
}

export function billingRouters(db: Db, gateways: ReturnType<typeof resolveGateways>) {
  const authed = Router(); const webhook = Router();
  const view = (tx: typeof paymentTransactions.$inferSelect) => ({ id: tx.id, invoiceId: tx.invoiceId, status: tx.status, providerRef: tx.providerRef, gateway: tx.gateway, simulated: tx.simulated });

  authed.post('/tenant/subscription/checkout', requirePermission('subscription.manage'), async (req, res, next) => {
    try {
      if (!gateways.active) throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', 'No payment gateway is configured');
      const b = z.object({ billingPeriod: z.enum(['monthly', 'annual']) }).parse(req.body);
      const u = db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, req.auth!.userId)).get();
      const r = await startCheckout(db, gateways.active, req.auth!.tenantId, b.billingPeriod, req.get('idempotency-key') ?? undefined, u ? { name: u.name, email: u.email, phone: u.phone ?? undefined } : undefined);
      res.status(201).json({ data: { invoice: { id: r.invoice.id, number: r.invoice.number, amount: r.invoice.amount, currency: r.invoice.currency, status: r.invoice.status, description: r.invoice.description }, transaction: view(r.tx), redirectUrl: (r as { redirectUrl?: string }).redirectUrl ?? null } });
    } catch (e) { next(e); }
  });
  authed.post('/tenant/subscription/checkout/:txId/sandbox-confirm', requirePermission('subscription.manage'), (req, res, next) => {
    try {
      if (gateways.active?.name !== 'sandbox') throw new HttpError(501, 'PAYMENT_NOT_CONFIGURED', 'Sandbox confirmation is not available');
      const row = db.select().from(paymentTransactions).where(and(eq(paymentTransactions.id, String(req.params.txId)), eq(paymentTransactions.tenantId, req.auth!.tenantId))).get();
      if (!row) throw notFound('Transaction not found');
      applyPaymentResult(db, row.id, 'succeeded');
      res.json({ data: view(db.select().from(paymentTransactions).where(eq(paymentTransactions.id, row.id)).get()!) });
    } catch (e) { next(e); }
  });
  authed.get('/tenant/billing/invoices', requirePermission('subscription.manage'), (req, res) => {
    const inv = db.select().from(billingInvoices).where(eq(billingInvoices.tenantId, req.auth!.tenantId)).orderBy(desc(billingInvoices.createdAt), desc(billingInvoices.number)).all();
    const txs = db.select().from(paymentTransactions).where(eq(paymentTransactions.tenantId, req.auth!.tenantId)).all();
    res.json({ data: inv.map((i) => ({ id: i.id, number: i.number, description: i.description, amount: i.amount, currency: i.currency, status: i.status, issuedAt: i.issuedAt, paidAt: i.paidAt, transactions: txs.filter((t) => t.invoiceId === i.id).map(view) })) });
  });

  webhook.post('/:provider', express.raw({ type: '*/*', limit: '256kb' }), (req, res, next) => {
    try {
      const gw = gateways.all[String(req.params.provider)]; if (!gw) throw notFound('Unknown provider');
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const ev = gw.verifyWebhook(req.headers, raw, req.query as Record<string, unknown>); if (!ev) throw new HttpError(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid');
      const out = db.transaction((tx) => {
        const d = tx as unknown as Db;
        if (ev.type === 'payment.ignored') return { duplicate: false, ignored: true }; // pending / voided: acknowledge so the provider stops retrying; nothing changes
        const dup = d.get(sql`insert into webhook_events (id, provider, event_id, payload_hash) values (${crypto.randomUUID()}, ${gw.name}, ${ev.eventId}, ${sha256(raw.toString('utf8'))}) on conflict (provider, event_id) do nothing returning id`);
        if (!dup) return { duplicate: true };
        const t = d.select().from(paymentTransactions).where(and(eq(paymentTransactions.gateway, gw.name), eq(paymentTransactions.providerRef, ev.providerRef))).get();
        if (!t) throw notFound('Unknown transaction');
        // Provider-reported amount/currency must equal what WE stored; otherwise never activate (guards against a cheaper payment replayed against a dearer invoice).
        if (ev.type !== 'payment.failed' && ((ev.amount !== undefined && ev.amount !== t.amount) || (ev.currency !== undefined && ev.currency.toUpperCase() !== t.currency.toUpperCase())))
          throw new HttpError(409, 'AMOUNT_MISMATCH', 'Webhook amount or currency does not match the transaction');
        if (ev.type === 'payment.refunded') applyRefund(d, t.id); else applyPaymentResult(d, t.id, ev.type === 'payment.succeeded' ? 'succeeded' : 'failed');
        return { duplicate: false };
      });
      res.json({ data: out });
    } catch (e) { next(e); }
  });
  return { authed, webhook };
}
export { plans, subscriptions };
