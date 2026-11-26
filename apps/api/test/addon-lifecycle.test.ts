import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addonEvents, auditLogs, createDb, notificationOutbox, notifications, seedPlatform, subscriptions, tenantAddOns } from '@codela/db';
import { createApp } from '../src/app';
import { createPlatformStaff } from '../src/platform-admin';
import { getEntitlements } from '../src/entitlements';
import { addMonths, runAddOnLifecycle } from '../src/addon-lifecycle';

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, uploadDir: mkdtempSync(path.join(tmpdir(), 'codela-al-')) }); });

const png = (n: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`receipt-${n}-`.padEnd(64, 'x'))]);
const KEY = 'extra_employees'; const DAY = 86_400_000;
async function setup() {
  const agent = request.agent(app); const r = await agent.post('/api/v1/auth/register-business').send({ businessName: 'Biz', slug: 'life', productSlug: 'medical', name: 'Owner', email: 'o@life.test', password: 'Str0ng-Pass!1' });
  const csrf = r.body.data.csrfToken as string; const id = r.body.data.tenant.id as string;
  await createPlatformStaff(db, { email: 'sa@codela.test', password: 'Admin-Pass-12345', name: 'SA', role: 'super_admin', department: 'management' });
  const adm = request.agent(app); const l = await adm.post('/api/v1/platform/auth/login').send({ email: 'sa@codela.test', password: 'Admin-Pass-12345' }); const pcsrf = l.body.data.csrfToken as string;
  await adm.put('/api/v1/platform/settings/payment').set('x-csrf-token', pcsrf).send({ value: { instapay: { enabled: true, handle: 'h@instapay', accountName: 'Co' } } });
  let n = 0;
  const pay = async () => { const s = await agent.post(`/api/v1/tenant/subscription/manual-payment?method=instapay&reference=REF-${++n}&kind=addon&addOnKey=${KEY}`).set('x-csrf-token', csrf).set('content-type', 'application/octet-stream').set('x-file-name', 'r.png').send(png(n)); return s; };
  const approve = async (sid: string, amount: number) => adm.post(`/api/v1/platform/manual-payments/${sid}/approve`).set('x-csrf-token', pcsrf).send({ confirmedAmount: amount });
  const reject = async (sid: string, reason: string) => adm.post(`/api/v1/platform/manual-payments/${sid}/reject`).set('x-csrf-token', pcsrf).send({ reason });
  const row = () => db.select().from(tenantAddOns).where(and(eq(tenantAddOns.tenantId, id), eq(tenantAddOns.addOnKey, KEY))).get()!;
  const events = () => db.select().from(addonEvents).where(eq(addonEvents.tenantId, id)).all().map((e) => e.action);
  const maxEmp = () => Number(getEntitlements(db, id).limits.maxEmployees);
  const buy = async () => { const s = await pay(); expect(s.status, JSON.stringify(s.body)).toBe(201); expect((await approve(s.body.data.id, s.body.data.amount)).status).toBe(200); };
  return { agent, id, pay, approve, reject, row, events, maxEmp, buy, list: async () => ((await agent.get('/api/v1/tenant/addons')).body.data as { key: string; status: string; expiresAt: string | null }[]).find((x) => x.key === KEY)! };
}
const at = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY);

describe('monthly add-on lifecycle (fake clock; renewal is always a manual payment)', () => {
  it('approval grants one paid month; the job marks renewal due once, expires after the month and drops access — data and history are kept', async () => {
    const t = await setup(); const base = t.maxEmp(); await t.buy();
    const granted = t.row(); expect(granted.status).toBe('active'); expect(Math.abs(new Date(granted.expiresAt!).getTime() - addMonths(new Date(), 1).getTime())).toBeLessThan(5000);
    expect(t.maxEmp()).toBe(base + 5); const end = granted.expiresAt!;

    expect(runAddOnLifecycle(db, at(end, -10))).toEqual({ due: 0, expired: 0 }); expect(t.row().status).toBe('active');
    expect(runAddOnLifecycle(db, at(end, -6))).toEqual({ due: 1, expired: 0 }); expect(t.row().status).toBe('renewal_due'); expect(t.maxEmp()).toBe(base + 5); // still has access while renewal is due
    expect(runAddOnLifecycle(db, at(end, -5))).toEqual({ due: 0, expired: 0 }); // idempotent: the owner is not nagged again
    const notes = db.select().from(notifications).where(eq(notifications.tenantId, t.id)).all().filter((x) => x.type === 'addon_renewal_due'); expect(notes).toHaveLength(1);
    const mails = db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.id)).all().filter((m) => m.template === 'subscription_notice'); expect(mails.some((m) => JSON.stringify(m.payload).includes('Renew it from Billing'))).toBe(true);
    expect((await t.list()).status).toBe('renewal_due');

    expect(runAddOnLifecycle(db, at(end, 1))).toEqual({ due: 0, expired: 1 }); const gone = t.row(); expect(gone.status).toBe('expired'); expect(gone.endedAt).toBeTruthy();
    expect(t.maxEmp()).toBe(base); // access is enforced by the backend: the extra employees are gone
    expect(db.select().from(notifications).where(eq(notifications.tenantId, t.id)).all().some((x) => x.type === 'addon_expired')).toBe(true);
    expect(db.select().from(auditLogs).where(eq(auditLogs.tenantId, t.id)).all().map((a) => a.action)).toEqual(expect.arrayContaining(['addon.renewal_due', 'addon.expired']));
    expect(t.events()).toEqual(['granted', 'renewal_due', 'expired']); expect(runAddOnLifecycle(db, at(end, 30))).toEqual({ due: 0, expired: 0 });
    expect(db.select().from(subscriptions).where(eq(subscriptions.tenantId, t.id)).get()).toBeTruthy(); // the subscription itself is untouched
  });

  it('renewing before the end extends from the old end (no lost days) and only through an approved manual payment', async () => {
    const t = await setup(); await t.buy(); const end = t.row().expiresAt!;
    expect((await t.pay()).body.error.code).toBe('ALREADY_ACTIVE'); // comfortably active: no double buying
    runAddOnLifecycle(db, at(end, -6)); expect((await t.list()).status).toBe('renewal_due');
    const s = await t.pay(); expect(s.status).toBe(201); expect(t.row().status).toBe('renewal_due'); expect(t.row().expiresAt).toBe(end); // a receipt alone changes nothing
    expect((await t.approve(s.body.data.id, s.body.data.amount)).status).toBe(200);
    const r = t.row(); expect(r.status).toBe('active'); expect(r.renewalDueAt).toBeNull(); expect(r.expiresAt).toBe(addMonths(new Date(end), 1).toISOString()); expect(t.events()).toEqual(['granted', 'renewal_due', 'renewed']);
    expect(runAddOnLifecycle(db, at(end, 1))).toEqual({ due: 0, expired: 0 }); expect(t.row().status).toBe('active'); // the renewed month is still running
  });

  it('a renewal receipt under review gives a short grace, then it expires; a rejected renewal is recorded; an expired add-on can be bought again', async () => {
    const t = await setup(); const base = t.maxEmp(); await t.buy(); const end = t.row().expiresAt!; runAddOnLifecycle(db, at(end, -6));
    const s = await t.pay(); expect(runAddOnLifecycle(db, at(end, 1))).toEqual({ due: 0, expired: 0 }); expect(t.row().status).toBe('renewal_due'); expect(t.maxEmp()).toBe(base + 5);
    expect((await t.reject(s.body.data.id, 'receipt is unreadable')).status).toBe(200);
    expect(t.events()).toContain('renewal_failed'); expect(db.select().from(notifications).where(eq(notifications.tenantId, t.id)).all().some((x) => x.type === 'addon_renewal_failed')).toBe(true);
    expect(runAddOnLifecycle(db, at(end, 1)).expired).toBe(1); expect(t.row().status).toBe('expired'); expect(t.maxEmp()).toBe(base);
    expect((await t.list()).status).toBe('expired'); await t.buy(); expect(t.row().status).toBe('active'); expect(t.maxEmp()).toBe(base + 5); expect(t.events().slice(-1)).toEqual(['renewed']);
  });

  it('a pending receipt only gives a short grace period before it expires', async () => {
    const t = await setup(); await t.buy(); const end = t.row().expiresAt!; runAddOnLifecycle(db, at(end, -6)); await t.pay();
    expect(runAddOnLifecycle(db, at(end, 2)).expired).toBe(0); expect(runAddOnLifecycle(db, at(end, 4)).expired).toBe(1);
  });

  it('a canceled add-on is left alone by the job', async () => {
    const t = await setup(); await t.buy(); const end = t.row().expiresAt!;
    db.update(tenantAddOns).set({ status: 'canceled', endedAt: new Date().toISOString() }).where(eq(tenantAddOns.id, t.row().id)).run();
    expect(runAddOnLifecycle(db, at(end, 40))).toEqual({ due: 0, expired: 0 }); expect(t.row().status).toBe('canceled');
  });
});
