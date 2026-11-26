import type { EntityDef, HookCtx, ProductDef, RecordRow } from './framework';
import { enqueue } from '../outbox';
import { toE164 } from '../phone';

/** Customer messages sent when a record reaches a status. Pure configuration: which entity/field, who to tell, which statuses. Medical appointments and e-commerce orders have their own dedicated hooks. */
interface Rule { entity: string; field?: string; statuses: string[]; viaRef?: string; phoneField?: string; emailField?: string }
const RULES: Record<string, Rule[]> = {
  booking: [{ entity: 'appointment', statuses: ['confirmed', 'cancelled', 'completed'], viaRef: 'customerId' }],
  automotive: [{ entity: 'workOrder', statuses: ['ready', 'delivered'], viaRef: 'customerId' }],
  fleet: [{ entity: 'shipment', statuses: ['out_for_delivery', 'delivered', 'failed_attempt'], phoneField: 'recipientPhone' }],
  restaurant: [{ entity: 'order', statuses: ['ready', 'out_for_delivery'], phoneField: 'customerPhone' }],
};

function notify(ctx: HookCtx, rule: Rule, record: RecordRow, previous?: RecordRow) {
  const status = String(record.data[rule.field ?? 'status'] ?? '');
  if (!previous || previous.data[rule.field ?? 'status'] === status || !rule.statuses.includes(status)) return;
  const person = rule.viaRef ? ctx.get(String(record.data[rule.viaRef]))?.data : record.data;
  if (!person) return;
  const email = typeof person[rule.emailField ?? 'email'] === 'string' ? String(person[rule.emailField ?? 'email']) : '';
  const phone = toE164(String(person[rule.phoneField ?? 'phone'] ?? ''));
  const payload = { code: record.code, name: person.name ?? person.customerName ?? '', status, date: record.data.date, time: record.data.startTime };
  const template = rule.entity === 'appointment' && status === 'confirmed' ? 'appointment_confirmed' : 'status_update';
  if (email) enqueue(ctx.db, ctx.tenantId, 'email', email, template, payload); else if (phone) enqueue(ctx.db, ctx.tenantId, 'sms', phone, template, payload);
}

/** Returns the product with the status-notification hooks composed onto its entities' own afterSave hooks. */
export function withStatusNotifications(p: ProductDef): ProductDef {
  const rules = RULES[p.slug]; if (!rules) return p;
  const entities = p.entities.map((e): EntityDef => {
    const rule = rules.find((r) => r.entity === e.key); if (!rule) return e;
    return { ...e, afterSave: (ctx, op) => { e.afterSave?.(ctx, op); if (op.action === 'update') notify(ctx, rule, op.record, op.previous); } };
  });
  return { ...p, entities };
}
