import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notificationOutbox, records } from '@codela/db';
import { queueAppointmentReminders, tomorrowIn } from '../src/reminders';
import { setup, tenantClient } from './_helpers';

describe('tomorrowIn', () => {
  it('uses the tenant time zone, not UTC', () => {
    const now = new Date('2030-03-10T22:30:00Z');             // 00:30 on 11 March in Cairo (UTC+2)
    expect(tomorrowIn('Africa/Cairo', now)).toBe('2030-03-12'); expect(tomorrowIn('UTC', now)).toBe('2030-03-11');
    expect(tomorrowIn('Not/AZone', now)).toBe('2030-03-11');   // unknown zone falls back to UTC
  });
});
describe('appointment reminders', () => {
  it('queues one e-mail per upcoming appointment tomorrow, never twice, skips cancelled and other days', () => {
    const { db, app } = setup(); return tenantClient(app, 'rem', 'medical').then((t) => {
      const base = { tenantId: t.tenantId, createdBy: null };
      const p = db.insert(records).values({ ...base, entityType: 'patient', code: 'PT-1', data: { name: 'Pat', email: 'pat@x.com' } }).returning().get();
      const now = new Date('2030-03-10T10:00:00Z'); const tomorrow = '2030-03-11';
      const mk = (code: string, date: string, status: string) => db.insert(records).values({ ...base, entityType: 'appointment', code, data: { patientId: p.id, doctorId: 'd', date, startTime: '10:00', status } }).returning().get();
      mk('AP-1', tomorrow, 'scheduled'); mk('AP-2', tomorrow, 'cancelled'); mk('AP-3', '2030-03-15', 'scheduled');
      expect(queueAppointmentReminders(db, now)).toBe(1);
      expect(queueAppointmentReminders(db, now)).toBe(0);
      const q = db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.tenantId)).all().filter((r) => r.template === 'appointment_reminder');
      expect(q).toHaveLength(1); expect(q[0]).toMatchObject({ channel: 'email', toAddr: 'pat@x.com', status: 'queued' });
    });
  });
});

describe('renewal notices', () => {
  it('e-mails the owner once when the period ends within 3 days; not for far-away or past ends', async () => {
    const { db, app } = setup(); const t = await tenantClient(app, 'ren', 'medical');
    const now = new Date('2030-03-10T10:00:00Z'); const { subscriptions } = await import('@codela/db');
    const set = (status: string, end: string | null) => db.update(subscriptions).set({ status, currentPeriodEnd: end, trialEndsAt: end }).where(eq(subscriptions.tenantId, t.tenantId)).run();
    const { queueRenewalNotices } = await import('../src/reminders');
    set('active', '2030-04-20T00:00:00.000Z'); expect(queueRenewalNotices(db, now)).toBe(0);
    set('active', '2030-03-01T00:00:00.000Z'); expect(queueRenewalNotices(db, now)).toBe(0);
    set('active', '2030-03-12T00:00:00.000Z'); expect(queueRenewalNotices(db, now)).toBe(1); expect(queueRenewalNotices(db, now)).toBe(0);
    const q = db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.tenantId)).all().filter((r) => r.template === 'subscription_notice');
    expect(q).toHaveLength(1); expect(q[0].toAddr).toBe('o@ren.test');
  });
});
