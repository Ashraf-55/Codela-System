import { and, eq, inArray, sql } from 'drizzle-orm';
import { notificationOutbox, records, subscriptions, tenants, type Db } from '@codela/db';
import { enqueue } from './outbox';
import { ownerEmail } from './owner';
import { toE164 } from './phone';

/** Product -> appointment entity, the person entity it points at, and which statuses are still upcoming. */
const CONFIG: Record<string, { person: string; ref: string; open: string[] }> = {
  medical: { person: 'patient', ref: 'patientId', open: ['scheduled', 'confirmed'] },
  booking: { person: 'customer', ref: 'customerId', open: ['pending', 'confirmed'] },
};

/** Calendar date (YYYY-MM-DD) of "tomorrow" in the tenant's time zone. */
export function tomorrowIn(tz: string, now = new Date()): string {
  let zone = tz; try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); } catch { zone = 'UTC'; }
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = fmt.format(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Queues one reminder per upcoming appointment dated tomorrow (tenant time zone). Idempotent: an appointment is never reminded twice. Returns how many were queued. */
export function queueAppointmentReminders(db: Db, now = new Date()): number {
  let n = 0;
  for (const t of db.select().from(tenants).where(eq(tenants.status, 'active')).all()) {
    const cfg = CONFIG[t.productSlug]; if (!cfg) continue;
    const date = tomorrowIn(t.timezone, now);
    const appts = db.select().from(records).where(and(eq(records.tenantId, t.id), eq(records.entityType, 'appointment'), sql`json_extract(${records.data}, '$.date') = ${date}`)).all()
      .filter((a) => cfg.open.includes(String(a.data.status)));
    for (const a of appts) {
      const done = db.select({ id: notificationOutbox.id }).from(notificationOutbox)
        .where(and(eq(notificationOutbox.tenantId, t.id), eq(notificationOutbox.template, 'appointment_reminder'), sql`json_extract(${notificationOutbox.payload}, '$.appointmentId') = ${a.id}`)).get();
      if (done) continue;
      const p = db.select().from(records).where(and(eq(records.id, String(a.data[cfg.ref])), eq(records.tenantId, t.id), inArray(records.entityType, [cfg.person]))).get(); if (!p) continue;
      const email = typeof p.data.email === 'string' && p.data.email ? p.data.email : undefined; const phone = typeof p.data.phone === 'string' ? toE164(p.data.phone) ?? undefined : undefined;
      const payload = { appointmentId: a.id, code: a.code, name: p.data.name, date: a.data.date, time: a.data.startTime };
      if (email) enqueue(db, t.id, 'email', email, 'appointment_reminder', payload); else if (phone) enqueue(db, t.id, 'sms', phone, 'appointment_reminder', payload); else continue;
      n++;
    }
  }
  return n;
}

/** E-mails the owner once per period when an active/trial subscription ends within `days` days. Payment is manual-renewal (a new checkout), so this is the only nudge. Returns how many were queued. */
export function queueRenewalNotices(db: Db, now = new Date(), days = 3): number {
  let n = 0; const limit = new Date(now.getTime() + days * 86_400_000).toISOString();
  for (const s of db.select().from(subscriptions).where(inArray(subscriptions.status, ['active', 'trialing'])).all()) {
    const end = s.status === 'trialing' ? s.trialEndsAt : s.currentPeriodEnd;
    if (!end || end <= now.toISOString() || end > limit) continue;
    const kind = `renew:${end}`;
    if (db.select({ id: notificationOutbox.id }).from(notificationOutbox).where(and(eq(notificationOutbox.tenantId, s.tenantId), eq(notificationOutbox.template, 'subscription_notice'), sql`json_extract(${notificationOutbox.payload}, '$.kind') = ${kind}`)).get()) continue;
    const to = ownerEmail(db, s.tenantId); if (!to) continue;
    const day = end.slice(0, 10); const link = process.env.PUBLIC_WEB_URL ? ` ${process.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/app/billing` : '';
    enqueue(db, s.tenantId, 'email', to, 'subscription_notice', { kind, messageEn: `Your ${s.status === 'trialing' ? 'trial' : 'subscription'} ends on ${day}. Renew from Billing to keep full access.${link}`, messageAr: `${s.status === 'trialing' ? 'تنتهي فترتك التجريبية' : 'ينتهي اشتراكك'} بتاريخ ${day}. جدّد من صفحة الفواتير للحفاظ على كامل الصلاحيات.${link}` });
    n++;
  }
  return n;
}
