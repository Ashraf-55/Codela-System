import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { notificationOutbox, tenants, type Db } from '@codela/db';
import { HttpError, conflict, notFound } from './errors';
import { getEntitlements } from './entitlements';
import { requirePermission } from './auth';
import { renderTemplate } from './templates';
import { queueAppointmentReminders, queueRenewalNotices } from './reminders';

export type Channel = 'email' | 'sms' | 'whatsapp';
export interface Message { to: string; subject?: string; body: string }
/** Real providers (SMTP, an SMS aggregator, WhatsApp Business API) implement this. None ships connected: see DEPLOYMENT.md. */
export interface NotificationProvider { send(m: Message): Promise<void | { id?: string }> }
export type Providers = Partial<Record<Channel, NotificationProvider>>;
export const MAX_ATTEMPTS = 3;
const ENTITLEMENT: Record<Channel, string | null> = { email: null, sms: 'sms', whatsapp: 'whatsapp' };

/** Queue a message (safe inside a transaction). Delivery happens afterwards via dispatchQueued. */
/** Template -> the preference key that can switch it off (account e-mails such as verify/reset/billing are never switched off). */
const PREF_OF: Record<string, 'reminders' | 'orders'> = { appointment_reminder: 'reminders', appointment_confirmed: 'reminders', booking_created: 'reminders', order_update: 'orders', status_update: 'orders' };
export function enqueue(db: Db, tenantId: string, channel: Channel, to: string, template: string, payload: Record<string, unknown>) {
  const ent = ENTITLEMENT[channel]; const entitled = !ent || getEntitlements(db, tenantId).limits[ent] === true;
  const prefs = db.select({ p: tenants.notifyPrefs }).from(tenants).where(eq(tenants.id, tenantId)).get()?.p ?? {};
  const kind = PREF_OF[template]; const optedOut = prefs[channel] === false || (kind !== undefined && prefs[kind] === false);
  db.insert(notificationOutbox).values({ tenantId, channel, toAddr: to, template, payload, status: optedOut ? 'opted_out' : entitled ? 'queued' : 'not_entitled' }).run();
}
/** Account-security mail (verification, password reset): ignores the tenant's notification preferences and plan entitlements - a business must never be able to switch off its own password reset. */
export function enqueueSystem(db: Db, tenantId: string, to: string, template: string, payload: Record<string, unknown>) {
  db.insert(notificationOutbox).values({ tenantId, channel: 'email', toAddr: to, template, payload, status: 'queued' }).run();
}
async function deliver(db: Db, providers: Providers, row: typeof notificationOutbox.$inferSelect) {
  const provider = providers[row.channel as Channel];
  if (!provider) return void db.update(notificationOutbox).set({ status: 'no_provider' }).where(eq(notificationOutbox.id, row.id)).run();
  const rendered = renderTemplate(db, row.template, row.channel, row.payload);
  if (!rendered) return void db.update(notificationOutbox).set({ status: 'failed', attempts: MAX_ATTEMPTS, lastError: `Unknown template ${row.template}` }).where(eq(notificationOutbox.id, row.id)).run();
  const msg = { ...rendered, to: row.toAddr };
  try { const sent = await provider.send(msg); db.update(notificationOutbox).set({ status: 'sent', attempts: row.attempts + 1, sentAt: new Date().toISOString(), lastError: null, providerId: sent && sent.id ? sent.id : null }).where(eq(notificationOutbox.id, row.id)).run(); }
  catch (e) { db.update(notificationOutbox).set({ status: 'failed', attempts: row.attempts + 1, lastError: String((e as Error).message).slice(0, 300) }).where(eq(notificationOutbox.id, row.id)).run(); }
}
export async function dispatchQueued(db: Db, providers: Providers, tenantId: string) {
  for (const row of db.select().from(notificationOutbox).where(and(eq(notificationOutbox.tenantId, tenantId), eq(notificationOutbox.status, 'queued'))).all()) await deliver(db, providers, row);
}
/** Worker pass: delivers every queued message (any tenant) and re-sends failed ones that have attempts left, with back-off of 2^attempts minutes from creation. */
export async function retryDue(db: Db, providers: Providers, now = new Date()) {
  let n = 0;
  for (const row of db.select().from(notificationOutbox).where(inArray(notificationOutbox.status, ['queued', 'failed'])).all()) {
    if (row.status === 'failed' && (row.attempts >= MAX_ATTEMPTS || now.getTime() - Date.parse(row.createdAt) < 2 ** row.attempts * 60_000)) continue;
    await deliver(db, providers, row); n++;
  }
  return n;
}
export function startOutboxWorker(db: Db, providers: Providers, everyMs = 60_000) {
  let lastReminders = 0;
  const t = setInterval(() => {
    const now = Date.now();
    if (now - lastReminders >= 3_600_000) { lastReminders = now; try { queueAppointmentReminders(db); queueRenewalNotices(db); } catch (e) { console.error('[outbox] reminders failed', String((e as Error)?.message ?? e)); } }
    retryDue(db, providers).catch((e) => console.error('[outbox] retry failed', String(e?.message ?? e)));
  }, everyMs); t.unref(); return () => clearInterval(t);
}
export function outboxRouter(db: Db, providers: Providers) {
  const r = Router();
  r.get('/tenant/outbox', requirePermission('tenant.settings'), (req, res) => res.json({ data: db.select({ id: notificationOutbox.id, channel: notificationOutbox.channel, toAddr: notificationOutbox.toAddr, template: notificationOutbox.template, status: notificationOutbox.status, attempts: notificationOutbox.attempts, lastError: notificationOutbox.lastError, createdAt: notificationOutbox.createdAt, sentAt: notificationOutbox.sentAt })
    .from(notificationOutbox).where(eq(notificationOutbox.tenantId, req.auth!.tenantId)).orderBy(desc(notificationOutbox.createdAt)).limit(100).all() }));
  r.post('/tenant/outbox/:id/retry', requirePermission('tenant.settings'), async (req, res, next) => {
    try {
      const row = db.select().from(notificationOutbox).where(and(eq(notificationOutbox.id, String(req.params.id)), eq(notificationOutbox.tenantId, req.auth!.tenantId))).get(); if (!row) throw notFound('Message not found');
      if (row.status !== 'failed' && row.status !== 'no_provider') throw conflict('Only failed messages can be retried');
      if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(409, 'CONFLICT', 'Maximum attempts reached');
      await deliver(db, providers, row); res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  return r;
}
