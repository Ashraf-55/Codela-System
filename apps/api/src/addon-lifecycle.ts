import { and, eq, inArray } from 'drizzle-orm';
import { addOns, addonEvents, auditLogs, manualPayments, tenantAddOns, type Db } from '@codela/db';
import { notifyTenant } from './notify';
import { enqueue } from './outbox';
import { ownerEmail } from './owner';

/** Recurring add-ons are paid per calendar month. A renewal reminder is raised this many days before the paid month ends. */
export const RENEWAL_WINDOW_DAYS = 7;
/** While a renewal receipt is waiting for review, access continues this long past the end of the month. */
export const REVIEW_GRACE_DAYS = 3;
const DAY = 86_400_000;

export const addMonths = (d: Date, n: number) => { const x = new Date(d.getTime()); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x; };
const event = (db: Db, tenantId: string, key: string, action: string, meta?: Record<string, unknown>) => db.insert(addonEvents).values({ tenantId, addOnKey: key, action, meta }).run();

/**
 * Grants (or renews) an add-on after an approved payment. Recurring add-ons get a paid month: a renewal extends from the later of
 * "now" and the current end, so paying early never loses days. One-time add-ons never expire.
 */
export function grantAddOn(db: Db, tenantId: string, ad: { key: string; billingType: string }, now: Date, via: string) {
  const ex = db.select().from(tenantAddOns).where(and(eq(tenantAddOns.tenantId, tenantId), eq(tenantAddOns.addOnKey, ad.key))).get();
  const recurring = ad.billingType === 'recurring';
  const liveEnd = ex && ['active', 'renewal_due'].includes(ex.status) && ex.expiresAt ? new Date(ex.expiresAt) : null;
  const base = liveEnd && liveEnd > now ? liveEnd : now; const expiresAt = recurring ? addMonths(base, 1).toISOString() : null; const iso = now.toISOString();
  if (ex) db.update(tenantAddOns).set({ status: 'active', startedAt: liveEnd ? ex.startedAt : iso, endedAt: null, expiresAt, renewalDueAt: null }).where(eq(tenantAddOns.id, ex.id)).run();
  else db.insert(tenantAddOns).values({ tenantId, addOnKey: ad.key, startedAt: iso, expiresAt }).run();
  event(db, tenantId, ad.key, ex ? 'renewed' : 'granted', { expiresAt, via });
}

/** Can a payment for this add-on be started now? Never while it is comfortably active (no double-buying), always when it is due / expired / canceled. */
export function addOnPurchasable(row: { status: string; expiresAt: string | null } | undefined, now = new Date()): boolean {
  if (!row || ['expired', 'canceled', 'renewal_due'].includes(row.status)) return true;
  return !!row.expiresAt && new Date(row.expiresAt).getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * DAY;
}

const tell = (db: Db, tenantId: string, type: string, nameEn: string, nameAr: string, en: string, ar: string) => {
  notifyTenant(db, tenantId, type, `${nameEn}: ${type === 'addon_expired' ? 'expired' : 'renewal due'}`, en);
  const to = ownerEmail(db, tenantId); if (to) enqueue(db, tenantId, 'email', to, 'subscription_notice', { messageEn: en, messageAr: ar });
  void nameAr;
};

/**
 * The scheduled job (run hourly and idempotent; `now` is injectable so tests use a fake clock):
 *   active + within the renewal window  -> renewal_due (owner notified once, history + audit written)
 *   past the paid month                  -> expired    (access drops at once; data is kept; owner told how to renew)
 *   past the month but a renewal receipt is under review -> stays renewal_due for a short grace, then expires
 * Renewal is always paid through the normal manual InstaPay / Vodafone Cash flow: nothing is ever charged silently.
 */
export function runAddOnLifecycle(db: Db, now = new Date()): { due: number; expired: number } {
  let due = 0; let expired = 0; const nowMs = now.getTime(); const iso = now.toISOString();
  const rows = db.select({ row: tenantAddOns, ad: addOns }).from(tenantAddOns).innerJoin(addOns, eq(addOns.key, tenantAddOns.addOnKey))
    .where(inArray(tenantAddOns.status, ['active', 'renewal_due'])).all();
  for (const { row, ad } of rows) {
    if (!row.expiresAt) continue; const end = new Date(row.expiresAt).getTime();
    const pending = !!db.select({ id: manualPayments.id }).from(manualPayments).where(and(eq(manualPayments.tenantId, row.tenantId), eq(manualPayments.addOnKey, row.addOnKey), eq(manualPayments.status, 'pending'))).get();
    if (nowMs >= end && !(pending && nowMs < end + REVIEW_GRACE_DAYS * DAY)) {
      db.transaction((tx) => {
        const d = tx as unknown as Db;
        d.update(tenantAddOns).set({ status: 'expired', endedAt: iso }).where(and(eq(tenantAddOns.id, row.id), inArray(tenantAddOns.status, ['active', 'renewal_due']))).run();
        event(d, row.tenantId, row.addOnKey, 'expired', { expiredAt: row.expiresAt });
        d.insert(auditLogs).values({ tenantId: row.tenantId, action: 'addon.expired', entity: 'addon', entityId: row.addOnKey, meta: { expiresAt: row.expiresAt } }).run();
        tell(d, row.tenantId, 'addon_expired', ad.nameEn, ad.nameAr, `Your add-on "${ad.nameEn}" has expired and its features are switched off. Your data is kept. Renew it from Billing with InstaPay or Vodafone Cash.`, `انتهت صلاحية الإضافة "${ad.nameAr}" وتم إيقاف مزاياها. بياناتك محفوظة. جدّد من صفحة الاشتراك عبر إنستاباي أو فودافون كاش.`);
      }); expired++;
    } else if (row.status === 'active' && nowMs >= end - RENEWAL_WINDOW_DAYS * DAY) {
      db.transaction((tx) => {
        const d = tx as unknown as Db;
        d.update(tenantAddOns).set({ status: 'renewal_due', renewalDueAt: iso }).where(and(eq(tenantAddOns.id, row.id), eq(tenantAddOns.status, 'active'))).run();
        event(d, row.tenantId, row.addOnKey, 'renewal_due', { expiresAt: row.expiresAt });
        d.insert(auditLogs).values({ tenantId: row.tenantId, action: 'addon.renewal_due', entity: 'addon', entityId: row.addOnKey, meta: { expiresAt: row.expiresAt } }).run();
        tell(d, row.tenantId, 'addon_renewal_due', ad.nameEn, ad.nameAr, `Your add-on "${ad.nameEn}" ends on ${row.expiresAt!.slice(0, 10)}. Renew it from Billing (InstaPay / Vodafone Cash) to keep it active.`, `تنتهي الإضافة "${ad.nameAr}" في ${row.expiresAt!.slice(0, 10)}. جدّدها من صفحة الاشتراك (إنستاباي / فودافون كاش) لتبقى فعّالة.`);
      }); due++;
    }
  }
  return { due, expired };
}

/** A rejected renewal receipt is recorded (never silent) and the owner is told what to do. */
export function recordRenewalRejected(db: Db, tenantId: string, key: string, reason: string) {
  const row = db.select().from(tenantAddOns).where(and(eq(tenantAddOns.tenantId, tenantId), eq(tenantAddOns.addOnKey, key))).get(); if (!row) return;
  event(db, tenantId, key, 'renewal_failed', { reason });
  notifyTenant(db, tenantId, 'addon_renewal_failed', 'Add-on renewal payment was not accepted', reason);
}

export function startAddOnScheduler(db: Db, everyMs = 60 * 60_000) {
  const tick = () => { try { runAddOnLifecycle(db); } catch (e) { console.error('[addons] lifecycle job failed', e); } };
  tick(); const t = setInterval(tick, everyMs); t.unref?.(); return t;
}
