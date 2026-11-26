import { and, eq } from 'drizzle-orm';
import { files } from '@codela/db';
import { notifyTenant } from '../notify';
import { enqueue } from '../outbox';
import { toE164 } from '../phone';
import { latinDigits, type EntityDef, type HookCtx, type ProductDef, type RecordRow } from './framework';

/**
 * Customer -> business manual payments (InstaPay / Vodafone Cash). NOT the platform subscription flow (manual-payments.ts).
 * The customer pays outside the system, then submits a reference and/or a receipt for ONE of their own open amounts (order, enrolment, invoice, booking).
 * Nothing is paid until an authorised staff member approves; approval creates the product's normal `payment` record through its own hooks
 * (so overpayment, status and balance rules cannot be bypassed) inside the same transaction. A rejection needs a reason.
 */
interface Cfg { target: string; personRef: string; link: string; open: (t: RecordRow) => boolean; due: (ctx: HookCtx, t: RecordRow) => number;
  /** when the payer is not a separate person record (restaurant orders carry the phone themselves; auto invoices belong to the work order's customer) */
  person?: (ctx: HookCtx, t: RecordRow) => Record<string, unknown> | undefined; payEntity?: string; payMethod?: string }
const sum = (ctx: HookCtx, entity: string, link: string, id: string) => ctx.find(entity, { [link]: id }).reduce((a, x) => a + Number(x.data.amount ?? 0), 0);
export const PAYABLE: Record<string, Cfg> = {
  ecommerce: { target: 'order', personRef: 'customerId', link: 'orderId', open: (t) => !['cancelled', 'returned'].includes(String(t.data.status)) && t.data.paymentStatus !== 'refunded', due: (c, t) => Number(t.data.total) - sum(c, 'payment', 'orderId', t.id) },
  learning: { target: 'enrollment', personRef: 'studentId', link: 'enrollmentId', open: (t) => t.data.status !== 'cancelled', due: (_c, t) => Number(t.data.price ?? 0) - Number(t.data.paidAmount ?? 0) },
  medical: { target: 'invoice', personRef: 'patientId', link: 'invoiceId', open: (t) => ['issued', 'partially_paid'].includes(String(t.data.status)), due: (_c, t) => Number(t.data.total ?? 0) - Number(t.data.paidAmount ?? 0) },
  booking: { target: 'appointment', personRef: 'customerId', link: 'appointmentId', open: () => true, due: (_c, t) => (['cancelled', 'no_show'].includes(String(t.data.status)) ? Number(t.data.cancelFee ?? 0) : Number(t.data.price ?? 0)) - Number(t.data.paidAmount ?? 0) },
};
const INV_OPEN = (t: RecordRow) => ['issued', 'partially_paid'].includes(String(t.data.status));
const INV_DUE = (_c: HookCtx, t: RecordRow) => Number(t.data.total ?? 0) - Number(t.data.paidAmount ?? 0);
PAYABLE.restaurant = { target: 'order', personRef: '', link: 'orderId', payEntity: 'orderPayment', payMethod: 'online', person: (_c, t) => (t.data.customerPhone ? { name: t.data.customerName, phone: t.data.customerPhone } : undefined),
  open: (t) => t.data.status !== 'cancelled' && t.data.paymentStatus === 'unpaid', due: (c, t) => Number(t.data.total) - sum(c, 'orderPayment', 'orderId', t.id) };
PAYABLE.automotive = { target: 'invoice', personRef: '', link: 'invoiceId', open: INV_OPEN, due: INV_DUE, person: (c, t) => { const wo = c.get(String(t.data.workOrderId)); return wo ? c.get(String(wo.data.customerId))?.data : undefined; } };
PAYABLE.construction = { target: 'invoice', personRef: 'clientId', link: 'invoiceId', open: INV_OPEN, due: INV_DUE };
PAYABLE.fleet = { target: 'invoice', personRef: 'customerId', link: 'invoiceId', open: INV_OPEN, due: INV_DUE };
PAYABLE.business = { target: 'invoice', personRef: 'customerId', link: 'invoiceId', open: INV_OPEN, due: INV_DUE };
/** Products that can reverse an approved customer payment through their OWN refund record (capped and audited there). Others must refund through their own flow first. */
const REFUNDERS: Record<string, (ctx: HookCtx, req: RecordRow, note: string) => void> = {
  booking: (ctx, req, note) => { ctx.createFull('refund', { appointmentId: req.data.targetId, amount: req.data.amount, method: 'transfer', reason: note }); },
};
export const METHODS = ['instapay', 'vodafone_cash'] as const;
const normPhone = (p: unknown) => latinDigits(String(p ?? '')).replace(/[\s\-().]/g, '');
const normRef = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const paymentAccount: EntityDef = { key: 'paymentAccount', module: 'paymentAccounts', labelEn: 'Payment account', labelAr: 'حساب استلام الدفع', titleField: 'method', subtitleField: 'handle', searchFields: ['accountName', 'handle'], filterable: ['method', 'active'],
  fields: { method: { type: 'enum', values: [...METHODS], required: true, unique: true }, accountName: { type: 'string', max: 120 }, handle: { type: 'string', required: true, max: 120 }, notes: { type: 'text' }, active: { type: 'bool', default: true } } };

function paymentRequest(slug: string): EntityDef {
  const cfg = PAYABLE[slug];
  return { key: 'paymentRequest', module: 'payments', labelEn: 'Payment request', labelAr: 'طلب دفع', titleField: '$code', subtitleField: 'status', autoCode: 'PRQ-', noCreate: true, noDelete: true, approvals: { field: 'status', values: ['approved', 'rejected', 'refunded'] },
    searchFields: ['targetCode', 'reference', 'payerName', 'payerPhone'], filterable: ['status', 'method', 'targetEntity', 'targetId'], immutableWhen: { field: 'status', values: ['rejected', 'refunded'] },
    fields: { targetEntity: { type: 'string', readonly: true }, targetId: { type: 'string', readonly: true }, targetCode: { type: 'string', readonly: true }, method: { type: 'enum', values: [...METHODS], readonly: true },
      amount: { type: 'money', readonly: true }, reference: { type: 'string', max: 80, readonly: true }, refNorm: { type: 'string', readonly: true }, payerName: { type: 'string', readonly: true }, payerPhone: { type: 'string', readonly: true },
      receiptFileId: { type: 'string', readonly: true }, status: { type: 'enum', values: ['pending', 'approved', 'rejected', 'refunded'], default: 'pending' }, reviewNote: { type: 'text' },
      reviewedBy: { type: 'string', readonly: true }, reviewedAt: { type: 'datetime', readonly: true }, paymentRecordId: { type: 'string', readonly: true } },
    beforeSave: (ctx, { action, data, existing }) => {
      if (action === 'create') return data; // only the public action creates requests (noCreate blocks the dashboard API)
      const prev = String(existing!.data.status), next = String(data.status);
      if (next === prev) { if (prev !== 'pending') ctx.fail(409, 'IMMUTABLE', 'A reviewed payment request cannot be edited'); return; }
      if (next === 'refunded') {
        if (prev !== 'approved') ctx.fail(409, 'INVALID_TRANSITION', 'Only an approved payment can be refunded');
        if (!REFUNDERS[slug]) ctx.fail(409, 'REFUND_NOT_SUPPORTED', 'Refund this payment from the item\'s own refund flow (e.g. returns / cancellation), then record it there');
        if (!String(data.reviewNote ?? '').trim()) ctx.fail(400, 'VALIDATION_ERROR', 'A refund reason is required');
        return { ...data, reviewedBy: ctx.userId, reviewedAt: ctx.now.toISOString() };
      }
      if (prev !== 'pending') ctx.fail(409, 'INVALID_TRANSITION', 'This payment request was already reviewed');
      if (next === 'rejected' && !String(data.reviewNote ?? '').trim()) ctx.fail(400, 'VALIDATION_ERROR', 'A rejection reason is required');
      return { ...data, reviewedBy: ctx.userId, reviewedAt: ctx.now.toISOString() };
    },
    afterSave: (ctx, { action, record, previous }) => {
      if (action === 'update' && previous?.data.status === 'approved' && record.data.status === 'refunded') { REFUNDERS[slug](ctx, record, String(record.data.reviewNote)); return; } // the product's refund hooks cap it and roll everything back on failure
      if (action !== 'update' || previous?.data.status !== 'pending' || record.data.status === 'pending') return;
      const target = ctx.get(String(record.data.targetId)); const person = target && personOf(ctx, cfg, target);
      if (record.data.status === 'approved') {
        // the product's own payment hooks enforce "no overpayment" etc.; a failure rolls the whole approval back
        const pay = ctx.createFull(cfg.payEntity ?? 'payment', { [cfg.link]: record.data.targetId, amount: record.data.amount, method: cfg.payMethod ?? 'transfer', ...(slug === 'ecommerce' ? { reference: String(record.data.reference ?? '').slice(0, 80) } : {}) });
        ctx.patch(record.id, { paymentRecordId: pay.id });
      }
      const email = person && typeof person.data.email === 'string' ? person.data.email : ''; const phone = person ? toE164(String(person.data.phone ?? '')) : '';
      const payload = { code: record.data.targetCode, status: record.data.status === 'approved' ? 'payment approved / تم قبول الدفع' : 'payment rejected / تم رفض الدفع' };
      if (email) enqueue(ctx.db, ctx.tenantId, 'email', email, 'status_update', payload); else if (phone) enqueue(ctx.db, ctx.tenantId, 'sms', phone, 'status_update', payload);
    } };
}

/** Finds the caller's own open target by public code + phone (the same proof the tracking / booking-management screens use). */
/** The payer of a target: a referenced person record, or data derived from the target itself. */
function personOf(ctx: HookCtx, cfg: Cfg, t: RecordRow): { data: Record<string, unknown> } | undefined {
  if (cfg.person) { const d = cfg.person(ctx, t); return d ? { data: d } : undefined; }
  const r = ctx.get(String(t.data[cfg.personRef])); return r ? { data: r.data } : undefined;
}
function locate(ctx: HookCtx, cfg: Cfg, code: unknown, phone: unknown) {
  const t = ctx.byCode(cfg.target, String(code ?? '').trim().toUpperCase()); const person = t && personOf(ctx, cfg, t);
  if (!t || !person || !person.data.phone || normPhone(person.data.phone) !== normPhone(phone)) ctx.fail(404, 'NOT_FOUND', 'Nothing found for this code and phone');
  return { t: t!, person: person! };
}
const pendingSum = (ctx: HookCtx, id: string) => ctx.find('paymentRequest', { targetId: id, status: 'pending' }).reduce((a, x) => a + Number(x.data.amount ?? 0), 0);

export function withCustomerPayments(p: ProductDef): ProductDef {
  const cfg = PAYABLE[p.slug]; if (!cfg) return p;
  return { ...p, entities: [...p.entities, paymentAccount, paymentRequest(p.slug)],
    publicActions: [...(p.publicActions ?? []),
      /** What is owed and how to pay (the business's configured InstaPay / Vodafone Cash details), after the caller proves ownership with code + phone. */
      { key: 'paymentDue', method: 'GET', write: false, handler: (ctx, q) => {
        const { t } = locate(ctx, cfg, q.code, q.phone); const due = cfg.open(t) ? Math.max(0, cfg.due(ctx, t)) : 0; const pend = pendingSum(ctx, t.id);
        const accounts = ctx.find('paymentAccount', { active: true }).map((a) => ({ method: a.data.method, accountName: a.data.accountName ?? '', handle: a.data.handle, notes: a.data.notes ?? '' }));
        const requests = ctx.find('paymentRequest', { targetId: t.id }).map((r) => ({ code: r.code, method: r.data.method, amount: r.data.amount, status: r.data.status, reviewNote: r.data.status === 'rejected' ? r.data.reviewNote ?? '' : '', createdAt: r.createdAt }));
        return { code: t.code, due, pending: pend, payable: Math.max(0, due - pend), accounts, requests };
      } },
      { key: 'submitPayment', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
        const { t, person } = locate(ctx, cfg, b.code, b.phone);
        if (!cfg.open(t)) ctx.fail(409, 'NOT_PAYABLE', 'This item cannot take payments');
        const method = String(b.method ?? ''); const acc = ctx.find('paymentAccount', { method, active: true })[0];
        if (!acc) ctx.fail(400, 'METHOD_UNAVAILABLE', 'This payment method is not offered by the business');
        const amount = Number(b.amount); if (!Number.isInteger(amount) || amount <= 0) ctx.fail(400, 'VALIDATION_ERROR', 'amount must be a positive whole number of minor units');
        const room = Math.max(0, cfg.due(ctx, t)) - pendingSum(ctx, t.id); if (amount > room) ctx.fail(409, 'OVERPAYMENT', room > 0 ? 'The amount exceeds what is still payable (pending requests count)' : 'Nothing is payable right now');
        const reference = String(b.reference ?? '').trim().slice(0, 80); const receiptId = String(b.receiptId ?? '');
        if (reference.length < 4 && !receiptId) ctx.fail(400, 'VALIDATION_ERROR', 'Enter the transfer reference or attach the receipt');
        const refNorm = reference ? `${method}:${normRef(reference)}` : '';
        if (refNorm && ctx.find('paymentRequest', { refNorm }).some((r) => r.data.status !== 'rejected')) ctx.fail(409, 'DUPLICATE_PAYMENT', 'This transfer reference was already submitted');
        if (receiptId) {
          const f = ctx.db.select().from(files).where(and(eq(files.id, receiptId), eq(files.tenantId, ctx.tenantId), eq(files.purpose, 'receipt'))).get();
          if (!f || f.entityId) ctx.fail(400, 'RECEIPT_INVALID', 'Receipt not found or already used');
          const dup = ctx.db.select({ id: files.id }).from(files).where(and(eq(files.tenantId, ctx.tenantId), eq(files.sha256, f!.sha256), eq(files.entityType, 'paymentRequest'))).all();
          if (dup.some((d) => ctx.find('paymentRequest', { receiptFileId: d.id }).some((r) => r.data.status !== 'rejected'))) ctx.fail(409, 'DUPLICATE_PAYMENT', 'This receipt was already submitted');
        }
        const rec = ctx.create('paymentRequest', { // raw insert: the request's fields are readonly for the dashboard API, so they cannot go through validation
           targetEntity: cfg.target, targetId: t.id, targetCode: t.code, method, amount, reference: reference || undefined, refNorm: refNorm || undefined, payerName: String(b.payerName ?? person.data.name ?? '').slice(0, 120) || undefined, payerPhone: String(person.data.phone ?? ''), receiptFileId: receiptId || undefined, status: 'pending' });
        if (receiptId) ctx.db.update(files).set({ entityType: 'paymentRequest', entityId: rec.id }).where(and(eq(files.id, receiptId), eq(files.tenantId, ctx.tenantId))).run();
        notifyTenant(ctx.db, ctx.tenantId, 'payment', `Payment to review ${rec.code}`, `${t.code} — ${amount}`);
        return { code: rec.code, status: rec.data.status };
      } },
    ] };
}
