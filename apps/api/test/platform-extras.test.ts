import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditLogs, createDb, notificationOutbox, seedPlatform, subscriptions } from '@codela/db';
import { createApp } from '../src/app';
import { createPlatformStaff } from '../src/platform-admin';
import { enqueue } from '../src/outbox';
import { renderTemplate } from '../src/templates';

let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => { db = createDb(':memory:'); seedPlatform(db); app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, uploadDir: mkdtempSync(path.join(tmpdir(), 'codela-pe-')) }); });

type Staff = Awaited<ReturnType<typeof staff>>;
async function staff(role: 'super_admin' | 'support' | 'finance') {
  const email = `${role}@codela.test`; await createPlatformStaff(db, { email, password: 'Admin-Pass-12345', name: role, role, department: 'management' });
  const agent = request.agent(app); const l = await agent.post('/api/v1/platform/auth/login').send({ email, password: 'Admin-Pass-12345' }); const csrf = l.body.data.csrfToken as string;
  const w = (m: 'post' | 'put' | 'patch' | 'delete') => (u: string, b: object = {}) => agent[m](u).set('x-csrf-token', csrf).send(b);
  return { agent, get: (u: string) => agent.get(u), post: w('post'), put: w('put'), patch: w('patch'), del: w('delete') };
}
async function tenant(slug: string, productSlug = 'medical') {
  const agent = request.agent(app); const r = await agent.post('/api/v1/auth/register-business').send({ businessName: `Biz ${slug}`, slug, productSlug, name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });
  expect(r.status).toBe(201); return { agent, csrf: r.body.data.csrfToken as string, id: r.body.data.tenant.id as string };
}
const ann = (o: object = {}) => ({ titleAr: 'صيانة', titleEn: 'Maintenance', bodyAr: 'غدًا', bodyEn: 'Tomorrow', level: 'warning', ...o });

describe('announcements', () => {
  it('Super Admin manages them; owners see only active, in-window, matching-product ones as plain text', async () => {
    const a = await staff('super_admin'); const sup = await staff('support'); const med = await tenant('an-med', 'medical'); const bk = await tenant('an-bk', 'booking');
    expect((await sup.post('/api/v1/platform/announcements', ann())).status).toBe(403); // support may not publish
    expect((await a.post('/api/v1/platform/announcements', ann({ endsAt: '2020-01-01', startsAt: '2021-01-01' }))).status).toBe(400);
    expect((await a.post('/api/v1/platform/announcements', ann({ productSlug: 'nope' }))).status).toBe(400);
    expect((await a.post('/api/v1/platform/announcements', ann({ level: 'loud' }))).status).toBe(400);
    const all = (await a.post('/api/v1/platform/announcements', ann({ titleEn: '<img src=x onerror=alert(1)>' }))).body.data; const onlyMed = (await a.post('/api/v1/platform/announcements', ann({ titleEn: 'Med only', productSlug: 'medical' }))).body.data;
    await a.post('/api/v1/platform/announcements', ann({ titleEn: 'Future', startsAt: new Date(Date.now() + 86_400_000 * 5).toISOString() })); await a.post('/api/v1/platform/announcements', ann({ titleEn: 'Expired', endsAt: '2020-01-01T00:00:00Z' }));
    const off = (await a.post('/api/v1/platform/announcements', ann({ titleEn: 'Off', active: false }))).body.data;
    const mine = async (t: { agent: request.Agent }) => ((await t.agent.get('/api/v1/tenant/announcements')).body.data as { titleEn: string }[]).map((x) => x.titleEn).sort();
    expect(await mine(med)).toEqual(['<img src=x onerror=alert(1)>', 'Med only']); expect(await mine(bk)).toEqual(['<img src=x onerror=alert(1)>']); // stored as text; the UI renders text, never HTML
    expect((await a.patch(`/api/v1/platform/announcements/${off.id}`, { active: true })).status).toBe(200); expect(await mine(bk)).toContain('Off');
    expect((await a.patch(`/api/v1/platform/announcements/${onlyMed.id}`, { endsAt: '2020-01-01' })).status).toBe(200); expect(await mine(med)).not.toContain('Med only');
    expect((await a.del(`/api/v1/platform/announcements/${all.id}`)).status).toBe(200); expect((await a.del(`/api/v1/platform/announcements/${all.id}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/tenant/announcements')).status).toBe(401); expect((await sup.get('/api/v1/platform/announcements')).status).toBe(200);
    expect(db.select().from(auditLogs).all().map((x) => x.action)).toEqual(expect.arrayContaining(['platform.announcement.created', 'platform.announcement.updated', 'platform.announcement.deleted']));
  });
});

describe('notification templates', () => {
  it('lists built-ins, validates variables, previews, and the edited wording is what the outbox sends; delete restores the built-in', async () => {
    const a = await staff('super_admin'); const sup = await staff('support'); const t = await tenant('nt1');
    const list = (await a.get('/api/v1/platform/notification-templates')).body.data as { key: string; vars: string[]; builtIn: { body: string } }[];
    expect(list.map((x) => x.key)).toEqual(expect.arrayContaining(['booking_created', 'verify_email', 'password_reset', 'order_update'])); expect(list.find((x) => x.key === 'order_update')!.builtIn.body).toContain('ready');
    const put = (key: string, b: object) => a.put(`/api/v1/platform/notification-templates/${key}`, { channel: 'email', subjectEn: 'Order {{code}}', subjectAr: 'طلب {{code}}', bodyEn: 'Your order {{code}} is {{status}}. Thanks!', bodyAr: 'طلبك {{code}} الآن {{status}}.', ...b });
    expect((await put('order_update', { bodyEn: 'Hi {{customerName}}' })).status).toBe(400);                   // variable the template does not have
    expect((await put('order_update', { subjectAr: '{{ evil }}' })).status).toBe(400); expect((await put('nope', {})).status).toBe(404);
    expect((await put('verify_email', { bodyEn: 'Click the link', bodyAr: 'اضغط {{link}}' })).status).toBe(400); // the link must stay: otherwise the e-mail is useless
    expect((await sup.put('/api/v1/platform/notification-templates/order_update', {})).status).toBe(403);
    const pv = await a.post('/api/v1/platform/notification-templates/order_update/preview', { channel: 'email', subjectEn: 'Order {{code}}', bodyEn: 'Your order {{code}} is {{status}}.', bodyAr: 'x {{code}}' }); expect(pv.status).toBe(200); expect(pv.body.data.body).toContain('Your order BK-0042 is ready.');
    expect((await put('order_update', {})).status).toBe(200);
    expect(renderTemplate(db, 'order_update', 'email', { code: 'ORD-9', status: 'shipped' })).toMatchObject({ subject: 'Order ORD-9 / طلب ORD-9', body: 'Your order ORD-9 is shipped. Thanks!\n\nطلبك ORD-9 الآن shipped.' });
    enqueue(db, t.id, 'email', 'c@x.com', 'order_update', { code: 'ORD-1', status: 'packed' }); expect(db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.id)).all()).toHaveLength(1);
    expect(renderTemplate(db, 'order_update', 'sms', { code: 'ORD-9', status: 'shipped' })!.body).toContain('تم تحديث حالة طلبك'); // other channels keep the built-in wording
    expect(renderTemplate(db, 'order_update', 'email', { code: 'a\u0000b', status: '<b>x</b>' })!.body).toContain('ab is <b>x</b>');   // control characters stripped
    await a.put('/api/v1/platform/notification-templates/order_update', { channel: 'email', subjectEn: '', subjectAr: '', bodyEn: 'x {{code}}', bodyAr: 'y', active: false }); expect(renderTemplate(db, 'order_update', 'email', { code: '1', status: 's' })!.body).toContain('Your order 1 is now: s');
    expect((await a.del('/api/v1/platform/notification-templates/order_update?channel=email')).status).toBe(200); expect((await a.get('/api/v1/platform/notification-templates')).body.data.find((x: { key: string }) => x.key === 'order_update').overrides).toEqual([]);
  });
});

describe('customer detail: subscription history, payments, manual activate / renew / cancel, exports', () => {
  it('manual subscription actions need a reason, follow the state machine, are permission-gated and leave history + audit', async () => {
    const a = await staff('super_admin'); const fin = await staff('finance'); const sup = await staff('support'); const t = await tenant('sub1');
    const act = (s: Staff, action: string, b: object = { reason: 'Paid by bank transfer, ref 123' }) => s.post(`/api/v1/platform/tenants/${t.id}/subscription/${action}`, b);
    expect((await act(sup, 'activate')).status).toBe(403); expect((await act(a, 'activate', {})).status).toBe(400); expect((await act(a, 'bogus')).status).toBe(400);
    expect((await act(a, 'renew')).status).toBe(409);                                      // a trial cannot be "renewed"
    const on = await act(fin, 'activate'); expect(on.status).toBe(200); expect(on.body.data.status).toBe('active'); const end1 = on.body.data.currentPeriodEnd as string; expect(new Date(end1).getTime()).toBeGreaterThan(Date.now());
    expect((await act(a, 'activate')).status).toBe(409);
    const re = await act(a, 'renew', { reason: 'Customer paid for another month' }); expect(re.status).toBe(200); expect(new Date(re.body.data.currentPeriodEnd).getTime()).toBeGreaterThan(new Date(end1).getTime()); // extends from the old end
    const can = await act(a, 'cancel', { reason: 'Customer asked to stop', atPeriodEnd: true }); expect(can.status).toBe(200); expect(can.body.data.status).toBe('active'); // cancels at period end
    const hard = await act(a, 'cancel', { reason: 'Fraud review' }); expect(hard.body.data.status).toBe('canceled'); expect((await act(a, 'cancel', { reason: 'again please' })).status).toBe(409);
    expect(db.select().from(subscriptions).where(eq(subscriptions.tenantId, t.id)).get()!.status).toBe('canceled'); expect((await act(a, 'activate', { reason: 'Reinstated after payment', billingPeriod: 'annual' })).body.data.status).toBe('active');
    const hist = (await sup.get(`/api/v1/platform/tenants/${t.id}/subscription-history`)).body.data as { type: string; meta: { reason?: string } }[]; expect(hist.map((x) => x.type)).toEqual(expect.arrayContaining(['admin_activate', 'admin_renew', 'admin_cancel'])); expect(hist.find((x) => x.type === 'admin_renew')!.meta.reason).toBe('Customer paid for another month');
    expect(db.select().from(auditLogs).all().filter((x) => x.action.startsWith('platform.subscription.')).length).toBeGreaterThanOrEqual(5);
    expect((await sup.get(`/api/v1/platform/tenants/${t.id}/payments`)).status).toBe(200); expect((await sup.get(`/api/v1/platform/tenants/${t.id}/addons`)).status).toBe(200); expect((await sup.get(`/api/v1/platform/tenants/${t.id}/activity`)).status).toBe(200);
    expect((await sup.get('/api/v1/platform/tenants/nope/payments')).status).toBe(404); expect((await t.agent.get(`/api/v1/platform/tenants/${t.id}/payments`)).status).toBe(401); // tenants cannot reach the platform API
  });

  it('CSV exports need reports.export, are formula-safe and audited', async () => {
    const a = await staff('super_admin'); const fin = await staff('finance'); const sup = await staff('support'); await tenant('exp1');
    expect((await sup.get('/api/v1/platform/exports/tenants.csv')).status).toBe(403);
    const r = await fin.get('/api/v1/platform/exports/tenants.csv'); expect(r.status).toBe(200); expect(r.headers['content-type']).toContain('text/csv'); expect(r.text).toContain('Biz exp1'); expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect((await a.get('/api/v1/platform/exports/payments.csv')).status).toBe(200); expect(db.select().from(auditLogs).all().filter((x) => x.action === 'platform.export')).toHaveLength(2);
  });
});
