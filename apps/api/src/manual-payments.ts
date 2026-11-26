import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { addOns, auditLogs, billingInvoices, files, manualPayments, paymentTransactions, plans, platformSettings, subscriptionEvents, subscriptions, tenantAddOns, tenants, users, type Db } from '@codela/db';
import { HttpError, badRequest, notFound } from './errors';
import { effectiveLimits, getEntitlements, tenantProduct, usage } from './entitlements';
import { requirePermission } from './auth';
import { detectFile } from './file-validation';
import { applyPaymentResult, nextInvoiceNumber } from './billing';
import { absPath, send } from './uploads';
import { notifyTenant } from './notify';
import { enqueue } from './outbox';
import { ownerEmail } from './owner';
import { addOnPurchasable, grantAddOn, recordRenewalRejected } from './addon-lifecycle';

/**
 * Manual payment verification (first release): the customer pays outside the platform via InstaPay or Vodafone Cash,
 * uploads the receipt and the transfer reference, and a Codela staff member approves or rejects it.
 * A subscription is activated ONLY by an approval (through the same applyPaymentResult path as gateway payments).
 * Payment numbers/handles are never hardcoded: they come from the platform setting `payment` (Super Admin).
 */
export const MANUAL_METHODS = ['instapay', 'vodafone_cash'] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_PER_TENANT = 3;
const normRef = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Public-to-tenant view of the configured instructions: only whitelisted string fields of ENABLED methods. */
export function paymentInstructions(db: Db): { method: ManualMethod; accountName: string; handle: string; notes: string }[] {
  const v = (db.select().from(platformSettings).where(eq(platformSettings.key, 'payment')).get()?.value ?? {}) as Record<string, unknown>;
  const out: { method: ManualMethod; accountName: string; handle: string; notes: string }[] = [];
  for (const m of MANUAL_METHODS) {
    const c = v[m]; if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const handle = clip(m === 'instapay' ? o.handle : o.number, 120);
    if (o.enabled !== true || !handle) continue; // an unconfigured method is never offered
    out.push({ method: m, accountName: clip(o.accountName, 120), handle, notes: clip(o.notes, 500) });
  }
  return out;
}

const view = (m: typeof manualPayments.$inferSelect) => ({
  id: m.id, method: m.method, reference: m.reference, payerName: m.payerName, amount: m.amount, currency: m.currency, billingPeriod: m.billingPeriod,
  status: m.status, reviewNote: m.reviewNote, reviewedAt: m.reviewedAt, createdAt: m.createdAt, invoiceId: m.invoiceId, kind: m.kind, addOnKey: m.addOnKey, targetPlanId: m.targetPlanId,
});

/** Refuses a move to a plan whose limits are below what the tenant already uses (same rule as the free downgrade path). */
function assertFitsPlan(db: Db, tenantId: string, target: typeof plans.$inferSelect) {
  const lim = effectiveLimits(db, tenantId, target.limits); const u = usage(db, tenantId);
  for (const k of ['maxEmployees', 'maxRecords'] as const)
    if (typeof lim[k] === 'number' && u[k] > (lim[k] as number)) throw new HttpError(409, 'DOWNGRADE_BLOCKED', `Current usage of ${k} (${u[k]}) exceeds the ${target.tier} limit (${lim[k]})`);
}

export function manualPaymentTenantRouter(db: Db, opts: { uploadDir: string }) {
  const r = Router();
  r.get('/tenant/subscription/manual-payment/instructions', requirePermission('subscription.manage'), (req, res) => {
    const tenantId = req.auth!.tenantId; const prod = tenantProduct(db, tenantId)!; const e = getEntitlements(db, tenantId);
    const mine = new Map(db.select().from(tenantAddOns).where(eq(tenantAddOns.tenantId, tenantId)).all().map((x) => [x.addOnKey, x]));
    res.json({ data: { methods: paymentInstructions(db), currentTier: e.plan.tier,
      plans: db.select().from(plans).where(and(eq(plans.productSlug, prod), eq(plans.active, true))).all().map((p) => ({ tier: p.tier, nameAr: p.nameAr, nameEn: p.nameEn, priceMonthly: p.priceMonthly, priceAnnual: p.priceAnnual, currency: p.currency })),
      addOns: db.select().from(addOns).where(eq(addOns.active, true)).all().filter((a) => a.compatibleProducts === '*' || a.compatibleProducts.includes(prod))
        .map((a) => ({ key: a.key, nameAr: a.nameAr, nameEn: a.nameEn, priceMinor: a.priceMinor, currency: a.currency, billingType: a.billingType, status: mine.get(a.key)?.status ?? 'available', expiresAt: mine.get(a.key)?.expiresAt ?? null, canBuy: addOnPurchasable(mine.get(a.key)) })) } });
  });

  r.get('/tenant/subscription/manual-payments', requirePermission('subscription.manage'), (req, res) => {
    const rows = db.select().from(manualPayments).where(eq(manualPayments.tenantId, req.auth!.tenantId)).orderBy(desc(manualPayments.createdAt)).limit(100).all();
    res.json({ data: rows.map(view) });
  });

  // Own receipt only (tenant-scoped lookup: another tenant's id is indistinguishable from a missing one).
  r.get('/tenant/subscription/manual-payments/:id/receipt', requirePermission('subscription.manage'), (req, res, next) => {
    try {
      const m = db.select().from(manualPayments).where(and(eq(manualPayments.id, String(req.params.id)), eq(manualPayments.tenantId, req.auth!.tenantId))).get(); if (!m) throw notFound('Payment not found');
      const f = db.select().from(files).where(and(eq(files.id, m.receiptFileId), eq(files.tenantId, m.tenantId))).get(); if (!f) throw notFound('Receipt not found');
      send(res, absPath(opts.uploadDir, f.tenantId, f.storageKey), f, 'attachment', 'private, no-store');
    } catch (e) { next(e); }
  });

  /** Body = raw receipt bytes (png/jpg/webp/pdf, ≤ 5 MB); metadata in the query string; original name in x-file-name. */
  r.post('/tenant/subscription/manual-payment', requirePermission('subscription.manage'), express.raw({ type: () => true, limit: RECEIPT_MAX_BYTES }), (req, res, next) => {
    let target: string | null = null;
    try {
      const a = req.auth!;
      // NOTE: no assertWritable here on purpose: an expired/suspended-for-nonpayment tenant must still be able to pay and renew.
      const q = z.object({
        billingPeriod: z.enum(['monthly', 'annual']).default('monthly'), method: z.enum(MANUAL_METHODS),
        kind: z.enum(['plan', 'addon']).default('plan'), planTier: z.enum(['starter', 'professional', 'business']).optional(), addOnKey: z.string().trim().max(60).optional(),
        reference: z.string().trim().min(4).max(64).regex(/^[\p{L}\p{N}\-_. /]+$/u, 'Reference contains invalid characters'),
        payerName: z.string().trim().max(80).optional(),
      }).parse(req.query);
      if (!paymentInstructions(db).some((i) => i.method === q.method)) throw new HttpError(409, 'METHOD_UNAVAILABLE', 'This payment method is not available');

      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length === 0) throw badRequest('A receipt file is required');
      let name = 'receipt'; try { name = decodeURIComponent(String(req.get('x-file-name') ?? 'receipt')); } catch { /* keep default */ }
      const d = detectFile(buf, name);
      if (!d || !(d.kind === 'image' || d.mime === 'application/pdf')) throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'The receipt must be a PNG, JPG, WEBP or PDF file');
      const sha = createHash('sha256').update(buf).digest('hex'); const refNorm = normRef(q.reference);

      const pending = db.select({ c: count() }).from(manualPayments).where(and(eq(manualPayments.tenantId, a.tenantId), eq(manualPayments.status, 'pending'))).get()!.c;
      if (pending >= MAX_PENDING_PER_TENANT) throw new HttpError(409, 'TOO_MANY_PENDING', 'You already have payment requests awaiting review');
      const dupRef = db.select({ id: manualPayments.id }).from(manualPayments).where(and(eq(manualPayments.method, q.method), eq(manualPayments.referenceNorm, refNorm), sql`${manualPayments.status} <> 'rejected'`)).get();
      const dupFile = db.select({ id: manualPayments.id }).from(manualPayments).where(and(eq(manualPayments.receiptSha256, sha), sql`${manualPayments.status} <> 'rejected'`)).get();
      if (dupRef || dupFile) throw new HttpError(409, 'DUPLICATE_PAYMENT', 'This transfer reference or receipt has already been submitted');

      const e = getEntitlements(db, a.tenantId);
      // What is being paid for: a plan (the current one, or another tier = upgrade/downgrade applied ONLY on approval) or an add-on (activated ONLY on approval).
      const prod = tenantProduct(db, a.tenantId)!;
      let amount = 0; let currency = e.plan.currency; let targetPlanId: string | null = null; let addOnKey: string | null = null; let description = ''; let period: string = q.billingPeriod; let invoicePlanId = e.plan.id;
      if (q.kind === 'addon') {
        if (!q.addOnKey) throw badRequest('addOnKey is required for an add-on payment');
        const ad = db.select().from(addOns).where(and(eq(addOns.key, q.addOnKey), eq(addOns.active, true))).get();
        if (!ad || !(ad.compatibleProducts === '*' || ad.compatibleProducts.includes(prod))) throw notFound('Add-on not available for your product');
        if (!addOnPurchasable(db.select().from(tenantAddOns).where(and(eq(tenantAddOns.tenantId, a.tenantId), eq(tenantAddOns.addOnKey, ad.key))).get())) throw new HttpError(409, 'ALREADY_ACTIVE', 'This add-on is already active (renewal opens 7 days before it ends)');
        if (db.select({ id: manualPayments.id }).from(manualPayments).where(and(eq(manualPayments.tenantId, a.tenantId), eq(manualPayments.addOnKey, ad.key), eq(manualPayments.status, 'pending'))).get()) throw new HttpError(409, 'ALREADY_PENDING', 'A payment for this add-on is already awaiting review');
        amount = ad.priceMinor; currency = ad.currency; addOnKey = ad.key; period = ad.billingType === 'recurring' ? 'monthly' : 'one_time'; description = `${ad.nameEn} — add-on (${q.method})`;
      } else {
        const target = db.select().from(plans).where(and(eq(plans.productSlug, prod), eq(plans.tier, q.planTier ?? e.plan.tier), eq(plans.active, true))).get(); if (!target) throw notFound('Plan not found');
        if (target.id !== e.plan.id) assertFitsPlan(db, a.tenantId, target);
        amount = q.billingPeriod === 'annual' ? target.priceAnnual : target.priceMonthly; currency = target.currency; targetPlanId = target.id; invoicePlanId = target.id;
        description = `${target.nameEn} — ${q.billingPeriod} (${q.method})`;
      }
      if (!(amount > 0)) throw badRequest('Nothing payable for this selection');
      const t = db.select().from(tenants).where(eq(tenants.id, a.tenantId)).get()!;

      const key = `${randomBytes(16).toString('hex')}.${d.ext}`;
      mkdirSync(path.join(opts.uploadDir, a.tenantId), { recursive: true });
      target = absPath(opts.uploadDir, a.tenantId, key); writeFileSync(target, buf, { flag: 'wx', mode: 0o640 });

      const row = db.transaction((tx) => {
        const x = tx as unknown as Db; const now = new Date().toISOString();
        const file = x.insert(files).values({ tenantId: a.tenantId, ownerUserId: a.userId, purpose: 'receipt', originalName: name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'receipt', mime: d.mime, size: buf.length, sha256: sha, storageKey: key, visibility: 'private' }).returning().get();
        const invoice = x.insert(billingInvoices).values({ tenantId: a.tenantId, number: nextInvoiceNumber(x, a.tenantId, t.slug), subscriptionId: e.subscriptionId, planId: invoicePlanId, billingPeriod: period, description, amount, currency, issuedAt: now }).returning().get();
        const gw = q.method;
        const tx2 = x.insert(paymentTransactions).values({ tenantId: a.tenantId, invoiceId: invoice.id, gateway: gw, providerRef: `man_${randomBytes(10).toString('hex')}`, idempotencyKey: `${a.tenantId}:manual:${randomBytes(8).toString('hex')}`, amount, currency, simulated: false }).returning().get();
        const m = x.insert(manualPayments).values({ tenantId: a.tenantId, transactionId: tx2.id, invoiceId: invoice.id, method: q.method, reference: q.reference, referenceNorm: refNorm, payerName: q.payerName || null, amount, currency, billingPeriod: period, kind: q.kind, targetPlanId, addOnKey, receiptFileId: file.id, receiptSha256: sha, submittedBy: a.userId }).returning().get();
        x.insert(auditLogs).values({ action: 'billing.manual_payment.submitted', tenantId: a.tenantId, actorId: a.userId, entity: 'manual_payment', entityId: m.id, meta: { method: q.method, amount, kind: q.kind, plan: q.planTier, addOn: addOnKey } }).run();
        notifyTenant(x, a.tenantId, 'payment_submitted', 'Payment submitted', `Your ${q.method === 'instapay' ? 'InstaPay' : 'Vodafone Cash'} payment (${description}) is awaiting review.`);
        return m;
      });
      res.status(201).json({ data: view(row) });
    } catch (e) {
      if (target) rmSync(target, { force: true }); // never leave an orphan receipt behind
      if (/UNIQUE constraint failed/.test(String((e as Error)?.message))) return next(new HttpError(409, 'DUPLICATE_PAYMENT', 'This transfer reference or receipt has already been submitted'));
      next(e);
    }
  });
  return r;
}

/** Registers the Super Admin review routes on the (already authenticated, CSRF-protected) platform router. */
export function registerManualPaymentReview(r: Router, db: Db, h: {
  need: (perm: string) => (req: Request, res: Response, next: NextFunction) => void;
  audit: (req: Request, action: string, entity?: string, entityId?: string, meta?: Record<string, unknown>) => unknown;
  uploadDir: string;
}) {
  const listQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });

  r.get('/manual-payments', h.need('revenue.read'), (req, res, next) => {
    try {
      const q = listQuery.parse(req.query); const where = q.status ? eq(manualPayments.status, q.status) : undefined;
      const rows = db.select({ m: manualPayments, tenantName: tenants.name, tenantSlug: tenants.slug, reviewerName: users.name, planTier: plans.tier, planName: plans.nameEn }).from(manualPayments).innerJoin(tenants, eq(tenants.id, manualPayments.tenantId))
        .leftJoin(users, eq(users.id, manualPayments.reviewedBy)).leftJoin(plans, eq(plans.id, manualPayments.targetPlanId)).where(where)
        .orderBy(desc(manualPayments.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all();
      const total = db.select({ c: count() }).from(manualPayments).where(where).get()!.c;
      res.json({ data: rows.map((x) => ({ ...view(x.m), tenantId: x.m.tenantId, tenantName: x.tenantName, tenantSlug: x.tenantSlug, reviewedBy: x.m.reviewedBy, reviewerName: x.reviewerName, planTier: x.planTier, planName: x.planName })), meta: { total, page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });

  r.get('/manual-payments/:id/receipt', h.need('revenue.read'), (req, res, next) => {
    try {
      const m = db.select().from(manualPayments).where(eq(manualPayments.id, String(req.params.id))).get(); if (!m) throw notFound('Payment not found');
      const f = db.select().from(files).where(eq(files.id, m.receiptFileId)).get(); if (!f) throw notFound('Receipt not found');
      h.audit(req, 'platform.manual_payment.receipt_viewed', 'manual_payment', m.id);
      send(res, absPath(h.uploadDir, f.tenantId, f.storageKey), f, 'attachment', 'private, no-store');
    } catch (e) { next(e); }
  });

  r.post('/manual-payments/:id/approve', h.need('payments.review'), (req, res, next) => {
    try {
      // The reviewer must type the amount they SEE on the receipt; it has to match the invoice, otherwise nothing is activated.
      const b = z.object({ confirmedAmount: z.number().int().positive(), note: z.string().trim().max(300).optional() }).parse(req.body);
      const out = db.transaction((tx) => {
        const d = tx as unknown as Db;
        const m = d.select().from(manualPayments).where(eq(manualPayments.id, String(req.params.id))).get(); if (!m) throw notFound('Payment not found');
        if (m.status !== 'pending') throw new HttpError(409, 'ALREADY_REVIEWED', 'This payment has already been reviewed');
        if (b.confirmedAmount !== m.amount) throw new HttpError(409, 'AMOUNT_MISMATCH', 'The confirmed amount does not match the invoice amount');
        d.update(manualPayments).set({ status: 'approved', reviewedBy: req.platform!.userId, reviewedAt: new Date().toISOString(), reviewNote: b.note ?? null }).where(and(eq(manualPayments.id, m.id), eq(manualPayments.status, 'pending'))).run();
        if (m.kind === 'addon') {
          // an add-on payment must not renew the subscription period: close the transaction/invoice here and grant the add-on
          const ad = d.select().from(addOns).where(and(eq(addOns.key, String(m.addOnKey)), eq(addOns.active, true))).get(); if (!ad) throw new HttpError(409, 'ADDON_UNAVAILABLE', 'This add-on is no longer available');
          const now = new Date().toISOString();
          d.update(paymentTransactions).set({ status: 'succeeded' }).where(and(eq(paymentTransactions.id, m.transactionId), eq(paymentTransactions.status, 'pending'))).run();
          d.update(billingInvoices).set({ status: 'paid', paidAt: now }).where(eq(billingInvoices.id, m.invoiceId)).run();
          grantAddOn(d, m.tenantId, ad, new Date(now), 'manual_payment');
          notifyTenant(d, m.tenantId, 'payment_succeeded', 'Payment received', `${ad.nameEn} is now active.`);
          const to = ownerEmail(d, m.tenantId); if (to) enqueue(d, m.tenantId, 'email', to, 'subscription_notice', { messageEn: `Your payment was approved and the add-on "${ad.nameEn}" is now active.`, messageAr: `تمت الموافقة على الدفع وتم تفعيل الإضافة "${ad.nameAr}".` });
        } else {
          if (m.targetPlanId) { // apply the plan the customer paid for (upgrade only takes effect through an approved payment)
            const sub = d.select().from(subscriptions).where(eq(subscriptions.tenantId, m.tenantId)).get()!;
            if (sub.planId !== m.targetPlanId) {
              const target = d.select().from(plans).where(and(eq(plans.id, m.targetPlanId), eq(plans.active, true))).get(); if (!target) throw new HttpError(409, 'PLAN_UNAVAILABLE', 'The requested plan is no longer available');
              assertFitsPlan(d, m.tenantId, target);
              d.update(subscriptions).set({ planId: target.id }).where(eq(subscriptions.id, sub.id)).run();
              d.insert(subscriptionEvents).values({ tenantId: m.tenantId, subscriptionId: sub.id, type: 'plan_changed', fromStatus: sub.status, toStatus: sub.status, meta: { to: target.tier, via: 'manual_payment' } }).run();
            }
          }
          applyPaymentResult(d, m.transactionId, 'succeeded'); // marks the invoice paid and activates/renews the subscription
        }
        return m;
      });
      h.audit(req, 'platform.manual_payment.approved', 'manual_payment', out.id, { tenantId: out.tenantId, amount: out.amount, method: out.method });
      res.json({ data: { id: out.id, status: 'approved' } });
    } catch (e) { next(e); }
  });

  r.post('/manual-payments/:id/reject', h.need('payments.review'), (req, res, next) => {
    try {
      const b = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
      const out = db.transaction((tx) => {
        const d = tx as unknown as Db;
        const m = d.select().from(manualPayments).where(eq(manualPayments.id, String(req.params.id))).get(); if (!m) throw notFound('Payment not found');
        if (m.status !== 'pending') throw new HttpError(409, 'ALREADY_REVIEWED', 'This payment has already been reviewed');
        d.update(manualPayments).set({ status: 'rejected', reviewedBy: req.platform!.userId, reviewedAt: new Date().toISOString(), reviewNote: b.reason }).where(eq(manualPayments.id, m.id)).run();
        // A rejection must NOT touch the subscription (no past_due transition): only the transaction and invoice are closed.
        d.update(paymentTransactions).set({ status: 'failed' }).where(eq(paymentTransactions.id, m.transactionId)).run();
        d.update(billingInvoices).set({ status: 'void' }).where(eq(billingInvoices.id, m.invoiceId)).run();
        notifyTenant(d, m.tenantId, 'payment_rejected', 'Payment rejected', b.reason);
        if (m.kind === 'addon' && m.addOnKey) recordRenewalRejected(d, m.tenantId, m.addOnKey, b.reason);
        const to = ownerEmail(d, m.tenantId);
        if (to) enqueue(d, m.tenantId, 'email', to, 'subscription_notice', { messageEn: `Your payment request was rejected: ${b.reason}. You can submit a new receipt.`, messageAr: `تم رفض طلب الدفع: ${b.reason}. يمكنك رفع إيصال جديد.` });
        return m;
      });
      h.audit(req, 'platform.manual_payment.rejected', 'manual_payment', out.id, { tenantId: out.tenantId });
      res.json({ data: { id: out.id, status: 'rejected' } });
    } catch (e) { next(e); }
  });
}
