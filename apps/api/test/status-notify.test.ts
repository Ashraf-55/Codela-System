import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notificationOutbox } from '@codela/db';
import { PRODUCTS } from '../src/products/registry';
import type { HookCtx, RecordRow } from '../src/products/framework';
import { setup, tenantClient } from './_helpers';

const rec = (entityType: string, code: string, data: Record<string, unknown>, id = code): RecordRow => ({ id, tenantId: 't', entityType, code, data, createdAt: '', updatedAt: '' } as unknown as RecordRow);

describe('status notifications for products without a dedicated hook', () => {
  it('booking: confirmed -> e-mail (or normalised SMS when only a phone exists); unchanged/other statuses are silent', async () => {
    const { db, app } = setup(); const t = await tenantClient(app, 'stn', 'booking');
    const customers: Record<string, RecordRow> = { c1: rec('customer', 'C-1', { name: 'Ali', email: 'ali@x.com' }, 'c1'), c2: rec('customer', 'C-2', { name: 'Mona', phone: '01012345678' }, 'c2') };
    const ctx = { db, tenantId: t.tenantId, get: (id: string) => customers[id] } as unknown as HookCtx;
    const hook = PRODUCTS.booking.entities.find((e) => e.key === 'appointment')!.afterSave!;
    const upd = (cust: string, from: string, to: string) => hook(ctx, { action: 'update', record: rec('appointment', 'B-1', { customerId: cust, status: to, date: '2030-01-01', startTime: '10:00' }), previous: rec('appointment', 'B-1', { customerId: cust, status: from }) });
    upd('c1', 'pending', 'confirmed'); upd('c2', 'pending', 'cancelled'); upd('c1', 'confirmed', 'confirmed'); upd('c1', 'pending', 'no_show');
    const rows = db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.tenantId)).all();
    expect(rows.map((r) => [r.channel, r.toAddr, r.template])).toEqual([['email', 'ali@x.com', 'appointment_confirmed'], ['sms', '+201012345678', 'status_update']]);
  });
  it('fleet: out_for_delivery texts the recipient', async () => {
    const { db, app } = setup(); const t = await tenantClient(app, 'stf', 'fleet');
    const ctx = { db, tenantId: t.tenantId, now: new Date(), get: () => undefined, find: () => [], create: () => ({}), patch: () => undefined } as unknown as HookCtx;
    PRODUCTS.fleet.entities.find((e) => e.key === 'shipment')!.afterSave!(ctx, { action: 'update', record: rec('shipment', 'SH-1', { status: 'out_for_delivery', recipientPhone: '01112345678', recipientName: 'Sara' }), previous: rec('shipment', 'SH-1', { status: 'at_hub' }) });
    expect(db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, t.tenantId)).all().map((r) => [r.channel, r.toAddr])).toEqual([['sms', '+201112345678']]);
  });
});
