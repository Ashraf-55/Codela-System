import type { NextFunction, Request, Response, Router } from 'express';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { addonEvents, announcements, auditLogs, billingInvoices, manualPayments, notificationTemplates, products, subscriptionEvents, subscriptions, tenantAddOns, tenants, type Db } from '@codela/db';
import { applyEvent, type BillingPeriod } from '@codela/shared';
import { HttpError, badRequest, conflict, notFound } from './errors';
import { saveSub, toSub } from './entitlements';
import { TEMPLATES, TEMPLATE_SAMPLE, TEMPLATE_VARS, fillTemplate, varsIn } from './templates';
import { csvCell } from './products/routes';
import { notifyTenant } from './notify';

type Need = (perm: string) => (req: Request, res: Response, next: NextFunction) => void;
const iso = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).transform((v) => (v.length === 10 ? `${v}T00:00:00.000Z` : new Date(v).toISOString()));
const text = (max: number) => z.string().trim().max(max);

const announcementBody = z.object({
  titleAr: text(150).min(1), titleEn: text(150).min(1), bodyAr: text(2000).default(''), bodyEn: text(2000).default(''),
  level: z.enum(['info', 'warning', 'critical']).default('info'), productSlug: z.string().trim().max(40).nullish(),
  startsAt: iso.nullish(), endsAt: iso.nullish(), active: z.boolean().default(true),
}).refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

const channelEnum = z.enum(['email', 'sms', 'whatsapp']);
const templateBody = z.object({ channel: channelEnum.default('email'), subjectAr: text(200).default(''), subjectEn: text(200).default(''), bodyAr: text(4000).min(1), bodyEn: text(4000).min(1), active: z.boolean().default(true) });

/** Validates {{variables}}: only the template's own, and the ones it cannot work without (e.g. the link of a password reset) must stay. */
function checkVars(key: string, b: { subjectAr: string; subjectEn: string; bodyAr: string; bodyEn: string }) {
  const def = TEMPLATE_VARS[key]; if (!def) throw notFound('Unknown template');
  const used = new Set([b.subjectAr, b.subjectEn, b.bodyAr, b.bodyEn].flatMap(varsIn)); const unknown = [...used].filter((v) => !def.vars.includes(v));
  if (unknown.length) throw badRequest(`Unknown variables: ${unknown.map((v) => `{{${v}}}`).join(', ')}. Allowed: ${def.vars.map((v) => `{{${v}}}`).join(', ')}`);
  for (const req of def.required ?? []) for (const f of ['bodyAr', 'bodyEn'] as const) if (!varsIn(b[f]).includes(req)) throw badRequest(`{{${req}}} must stay in ${f}: the message is useless without it`);
}

export function mountPlatformExtras(r: Router, db: Db, need: Need, audit: (req: Request, action: string, entity?: string, entityId?: string, meta?: Record<string, unknown>) => unknown) {
  const knownProduct = (slug?: string | null) => { if (slug && !db.select().from(products).where(eq(products.slug, slug)).get()) throw badRequest('Unknown product'); };

  // ---- announcements (shown to business owners in their dashboard) ----
  r.get('/announcements', need('revenue.read'), (_req, res) => res.json({ data: db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(200).all() }));
  r.post('/announcements', need('settings.manage'), (req, res, next) => {
    try { const b = announcementBody.parse(req.body); knownProduct(b.productSlug);
      const row = db.insert(announcements).values({ ...b, productSlug: b.productSlug ?? null, startsAt: b.startsAt ?? null, endsAt: b.endsAt ?? null, createdBy: req.platform!.userId }).returning().get();
      audit(req, 'platform.announcement.created', 'announcement', row.id, { level: b.level, productSlug: b.productSlug ?? null }); res.status(201).json({ data: row }); } catch (e) { next(e); }
  });
  r.patch('/announcements/:id', need('settings.manage'), (req, res, next) => {
    try {
      const id = String(req.params.id); const cur = db.select().from(announcements).where(eq(announcements.id, id)).get(); if (!cur) throw notFound('Announcement not found');
      const merged = announcementBody.parse({ ...cur, ...req.body }); knownProduct(merged.productSlug);
      const row = db.update(announcements).set({ ...merged, productSlug: merged.productSlug ?? null, startsAt: merged.startsAt ?? null, endsAt: merged.endsAt ?? null, updatedAt: new Date().toISOString() }).where(eq(announcements.id, id)).returning().get();
      audit(req, 'platform.announcement.updated', 'announcement', id, { active: merged.active }); res.json({ data: row });
    } catch (e) { next(e); }
  });
  r.delete('/announcements/:id', need('settings.manage'), (req, res, next) => {
    try { const ch = db.delete(announcements).where(eq(announcements.id, String(req.params.id))).run().changes; if (!ch) throw notFound('Announcement not found'); audit(req, 'platform.announcement.deleted', 'announcement', String(req.params.id)); res.json({ data: { ok: true } }); } catch (e) { next(e); }
  });

  // ---- notification templates ----
  const sampleFor = (key: string) => Object.fromEntries((TEMPLATE_VARS[key]?.vars ?? []).map((v) => [v, TEMPLATE_SAMPLE[v] ?? v]));
  r.get('/notification-templates', need('revenue.read'), (_req, res) => {
    const ov = db.select().from(notificationTemplates).all();
    res.json({ data: Object.keys(TEMPLATES).map((key) => ({ key, vars: TEMPLATE_VARS[key]?.vars ?? [], required: TEMPLATE_VARS[key]?.required ?? [], builtIn: TEMPLATES[key](sampleFor(key)), overrides: ov.filter((o) => o.key === key) })) });
  });
  r.post('/notification-templates/:key/preview', need('revenue.read'), (req, res, next) => {
    try { const key = String(req.params.key); const b = templateBody.parse(req.body); checkVars(key, b); const allowed = TEMPLATE_VARS[key].vars; const vars = sampleFor(key);
      res.json({ data: { subject: [fillTemplate(b.subjectEn, vars, allowed), fillTemplate(b.subjectAr, vars, allowed)].filter(Boolean).join(' / '), body: `${fillTemplate(b.bodyEn, vars, allowed)}\n\n${fillTemplate(b.bodyAr, vars, allowed)}`, sampleValues: vars } }); } catch (e) { next(e); }
  });
  r.put('/notification-templates/:key', need('settings.manage'), (req, res, next) => {
    try {
      const key = String(req.params.key); const b = templateBody.parse(req.body); checkVars(key, b);
      db.insert(notificationTemplates).values({ key, ...b, updatedBy: req.platform!.userId }).onConflictDoUpdate({ target: [notificationTemplates.key, notificationTemplates.channel], set: { ...b, updatedBy: req.platform!.userId, updatedAt: new Date().toISOString() } }).run();
      audit(req, 'platform.notification_template.updated', 'notification_template', key, { channel: b.channel, active: b.active }); res.json({ data: { key, ...b } });
    } catch (e) { next(e); }
  });
  r.delete('/notification-templates/:key', need('settings.manage'), (req, res, next) => { // back to the built-in wording
    try { const key = String(req.params.key); const channel = channelEnum.parse(req.query.channel ?? 'email'); if (!TEMPLATES[key]) throw notFound('Unknown template');
      db.delete(notificationTemplates).where(and(eq(notificationTemplates.key, key), eq(notificationTemplates.channel, channel))).run(); audit(req, 'platform.notification_template.reset', 'notification_template', key, { channel }); res.json({ data: { ok: true } }); } catch (e) { next(e); }
  });

  // ---- per-customer subscription history, payments, add-ons, activity ----
  const tenantOr404 = (id: string) => db.select().from(tenants).where(eq(tenants.id, id)).get() ?? (() => { throw notFound('Tenant not found'); })();
  r.get('/tenants/:id/subscription-history', need('tenants.read'), (req, res, next) => {
    try { const t = tenantOr404(String(req.params.id)); res.json({ data: db.select().from(subscriptionEvents).where(eq(subscriptionEvents.tenantId, t.id)).orderBy(desc(subscriptionEvents.createdAt)).limit(200).all() }); } catch (e) { next(e); }
  });
  r.get('/tenants/:id/payments', need('revenue.read'), (req, res, next) => {
    try { const t = tenantOr404(String(req.params.id));
      res.json({ data: { manual: db.select({ id: manualPayments.id, kind: manualPayments.kind, method: manualPayments.method, reference: manualPayments.reference, amount: manualPayments.amount, currency: manualPayments.currency, status: manualPayments.status, addOnKey: manualPayments.addOnKey, reviewedBy: manualPayments.reviewedBy, reviewedAt: manualPayments.reviewedAt, reviewNote: manualPayments.reviewNote, createdAt: manualPayments.createdAt }).from(manualPayments).where(eq(manualPayments.tenantId, t.id)).orderBy(desc(manualPayments.createdAt)).limit(200).all(),
        invoices: db.select({ id: billingInvoices.id, number: billingInvoices.number, description: billingInvoices.description, amount: billingInvoices.amount, currency: billingInvoices.currency, status: billingInvoices.status, issuedAt: billingInvoices.issuedAt, paidAt: billingInvoices.paidAt }).from(billingInvoices).where(eq(billingInvoices.tenantId, t.id)).orderBy(desc(billingInvoices.createdAt)).limit(200).all() } }); } catch (e) { next(e); }
  });
  r.get('/tenants/:id/addons', need('revenue.read'), (req, res, next) => {
    try { const t = tenantOr404(String(req.params.id)); res.json({ data: { addOns: db.select().from(tenantAddOns).where(eq(tenantAddOns.tenantId, t.id)).all(), history: db.select().from(addonEvents).where(eq(addonEvents.tenantId, t.id)).orderBy(desc(addonEvents.createdAt)).limit(200).all() } }); } catch (e) { next(e); }
  });
  r.get('/tenants/:id/activity', need('audit.read'), (req, res, next) => {
    try { const t = tenantOr404(String(req.params.id)); res.json({ data: db.select({ id: auditLogs.id, action: auditLogs.action, entity: auditLogs.entity, entityId: auditLogs.entityId, actorId: auditLogs.actorId, createdAt: auditLogs.createdAt }).from(auditLogs).where(eq(auditLogs.tenantId, t.id)).orderBy(desc(auditLogs.createdAt)).limit(100).all() }); } catch (e) { next(e); }
  });

  // ---- manual activate / renew / cancel (an operator decision: reason required, state machine enforced, fully audited) ----
  r.post('/tenants/:id/subscription/:action', need('plans.manage'), (req, res, next) => {
    try {
      const action = z.enum(['activate', 'renew', 'cancel']).parse(req.params.action); const t = tenantOr404(String(req.params.id));
      const b = z.object({ reason: text(300).min(3), billingPeriod: z.enum(['monthly', 'annual']).optional(), atPeriodEnd: z.boolean().optional() }).parse(req.body);
      const row = db.select().from(subscriptions).where(eq(subscriptions.tenantId, t.id)).get(); if (!row) throw notFound('Subscription not found');
      const cur = toSub(row); const now = new Date(); let next_;
      try {
        if (action === 'cancel') next_ = applyEvent(cur, { type: 'cancel', atPeriodEnd: b.atPeriodEnd ?? false }, now);
        else {
          if (action === 'renew' && cur.status !== 'active') throw conflict('Only an active subscription can be renewed; use activate');
          if (action === 'activate' && cur.status === 'active') throw conflict('The subscription is already active; use renew to extend it');
          next_ = applyEvent({ ...cur, billingPeriod: (b.billingPeriod ?? cur.billingPeriod) as BillingPeriod }, { type: 'payment_succeeded' }, now);
        }
      } catch (e) { if (e instanceof HttpError) throw e; throw conflict((e as Error).message); }
      db.transaction((tx) => { saveSub(tx as unknown as Db, row.id, t.id, next_, `admin_${action}`, cur.status, { by: req.platform!.userId, reason: b.reason, manual: true }); });
      audit(req, `platform.subscription.${action}`, 'tenant', t.id, { from: cur.status, to: next_.status, reason: b.reason });
      notifyTenant(db, t.id, `subscription_${action}`, action === 'cancel' ? 'Subscription canceled' : 'Subscription updated', b.reason);
      res.json({ data: { status: next_.status, currentPeriodEnd: next_.currentPeriodEnd, canceledAt: next_.canceledAt } });
    } catch (e) { next(e); }
  });

  // ---- CSV exports (permission-gated, audited, formula-safe) ----
  const sendCsv = (req: Request, res: Response, name: string, head: string[], rows: unknown[][]) => {
    audit(req, 'platform.export', name, undefined, { rows: rows.length });
    res.setHeader('content-type', 'text/csv; charset=utf-8'); res.setHeader('content-disposition', `attachment; filename="${name}.csv"`); res.setHeader('cache-control', 'no-store');
    res.send('\uFEFF' + [head, ...rows].map((l) => l.map(csvCell).join(',')).join('\r\n'));
  };
  r.get('/exports/tenants.csv', need('reports.export'), (req, res, next) => {
    try { const rows = db.select({ name: tenants.name, slug: tenants.slug, product: tenants.productSlug, status: tenants.status, sub: subscriptions.status, periodEnd: subscriptions.currentPeriodEnd, createdAt: tenants.createdAt }).from(tenants).leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id)).orderBy(desc(tenants.createdAt)).limit(20_000).all();
      sendCsv(req, res, 'tenants', ['name', 'slug', 'product', 'status', 'subscription', 'periodEnd', 'createdAt'], rows.map((x) => [x.name, x.slug, x.product, x.status, x.sub, x.periodEnd, x.createdAt])); } catch (e) { next(e); }
  });
  r.get('/exports/payments.csv', need('reports.export'), (req, res, next) => {
    try { const rows = db.select({ tenant: tenants.name, kind: manualPayments.kind, method: manualPayments.method, reference: manualPayments.reference, amount: manualPayments.amount, currency: manualPayments.currency, status: manualPayments.status, reviewedAt: manualPayments.reviewedAt, createdAt: manualPayments.createdAt }).from(manualPayments).innerJoin(tenants, eq(tenants.id, manualPayments.tenantId)).orderBy(desc(manualPayments.createdAt)).limit(20_000).all();
      sendCsv(req, res, 'payments', ['tenant', 'kind', 'method', 'reference', 'amount_minor', 'currency', 'status', 'reviewedAt', 'createdAt'], rows.map((x) => [x.tenant, x.kind, x.method, x.reference, x.amount, x.currency, x.status, x.reviewedAt, x.createdAt])); } catch (e) { next(e); }
  });
}

/** Announcements a business owner should see now: active, inside their date window, for their product (or every product). */
export function activeAnnouncements(db: Db, productSlug: string, now = new Date()) {
  const t = now.toISOString();
  return db.select().from(announcements).where(and(eq(announcements.active, true), or(isNull(announcements.startsAt), lte(announcements.startsAt, t)), or(isNull(announcements.endsAt), gte(announcements.endsAt, t)), or(isNull(announcements.productSlug), eq(announcements.productSlug, productSlug))))
    .orderBy(desc(announcements.createdAt)).limit(10).all().map((a) => ({ id: a.id, titleAr: a.titleAr, titleEn: a.titleEn, bodyAr: a.bodyAr, bodyEn: a.bodyEn, level: a.level, createdAt: a.createdAt }));
}
