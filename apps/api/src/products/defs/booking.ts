import { applyBasisPoints } from '@codela/shared';
import { notifyTenant } from '../../notify';
import { enqueue } from '../../outbox';
import { latinDigits, minutesUntilLocal, validateData, type EntityDef, type HookCtx, type ProductDef, type RecordRow } from '../framework';

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ACTIVE = ['pending', 'confirmed'];
const normPhone = (p: unknown) => latinDigits(String(p ?? '')).replace(/[\s\-().]/g, '');

const branch: EntityDef = { key: 'branch', module: 'branches', labelEn: 'Branch', labelAr: 'فرع', titleField: 'name', searchFields: ['name', 'address'], filterable: ['active'],
  fields: { name: { type: 'string', required: true }, address: { type: 'string' }, phone: { type: 'phone' }, hours: { type: 'string' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'address', 'phone', 'hours'], filter: { active: true } } };
const serviceCategory: EntityDef = { key: 'serviceCategory', module: 'serviceCategories', labelEn: 'Service category', labelAr: 'تصنيف خدمة', titleField: 'name', searchFields: ['name'],
  fields: { name: { type: 'string', required: true, unique: true } }, public: { fields: ['name'] } };
const service: EntityDef = { key: 'service', module: 'services', labelEn: 'Service', labelAr: 'خدمة', titleField: 'name', searchFields: ['name', 'description'], filterable: ['categoryId', 'active'],
  fields: { name: { type: 'string', required: true, unique: true }, categoryId: { type: 'ref', entity: 'serviceCategory' }, durationMin: { type: 'int', min: 5, max: 720, required: true }, bufferMin: { type: 'int', min: 0, max: 240, default: 0 },
    price: { type: 'money', required: true }, description: { type: 'text' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'categoryId', 'durationMin', 'price', 'description'], filter: { active: true }, filterable: ['categoryId'] } };
const staff: EntityDef = { key: 'staff', module: 'staffMembers', labelEn: 'Staff member', labelAr: 'موظف', titleField: 'name', searchFields: ['name', 'title', 'phone'], filterable: ['branchId', 'active'],
  fields: { name: { type: 'string', required: true }, title: { type: 'string' }, bio: { type: 'text' }, phone: { type: 'phone' }, email: { type: 'email' }, branchId: { type: 'ref', entity: 'branch' },
    skills: { type: 'lines', max: 100, fields: { serviceId: { type: 'ref', entity: 'service', required: true } } }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'title', 'bio', 'branchId'], filter: { active: true } } };
const schedule: EntityDef = { key: 'schedule', module: 'schedules', labelEn: 'Working schedule', labelAr: 'جدول عمل', titleField: 'weekday', filterable: ['staffId', 'weekday'],
  fields: { staffId: { type: 'ref', entity: 'staff', required: true }, weekday: { type: 'int', min: 0, max: 6, required: true }, from: { type: 'time', required: true }, to: { type: 'time', required: true } },
  beforeSave: (ctx, { data }) => { if (hm(String(data.from)) >= hm(String(data.to))) ctx.fail(400, 'VALIDATION_ERROR', 'from must be before to'); } };
const timeOff: EntityDef = { key: 'timeOff', module: 'timeOff', labelEn: 'Time off', labelAr: 'إجازة', titleField: 'reason', filterable: ['staffId'],
  fields: { staffId: { type: 'ref', entity: 'staff', required: true }, fromDate: { type: 'date', required: true }, toDate: { type: 'date', required: true }, reason: { type: 'string' } },
  beforeSave: (ctx, { data }) => { if (String(data.toDate) < String(data.fromDate)) ctx.fail(400, 'VALIDATION_ERROR', 'toDate cannot be before fromDate'); } };
const customer: EntityDef = { key: 'customer', module: 'bookingCustomers', labelEn: 'Customer', labelAr: 'عميل', titleField: 'name', subtitleField: '$code', autoCode: 'CU-', searchFields: ['name', 'phone', 'email'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true, unique: true }, email: { type: 'email' }, notes: { type: 'text' } } };
const policy: EntityDef = { key: 'policy', module: 'policies', labelEn: 'Cancellation policy', labelAr: 'سياسة الإلغاء', titleField: 'name',
  fields: { name: { type: 'string', required: true }, freeCancelHours: { type: 'int', min: 0, max: 720, default: 24 }, lateFeeBp: { type: 'int', min: 0, max: 10000, default: 0 }, noShowFeeBp: { type: 'int', min: 0, max: 10000, default: 0 }, active: { type: 'bool', default: true } } };

interface Slot { date: string; startTime: string; durationMin: number; blockMin: number }
const blocksFor = (ctx: HookCtx, staffId: string, date: string, excludeId?: string) =>
  ctx.find('appointment', { staffId, date }).filter((a) => a.id !== excludeId && ACTIVE.includes(String(a.data.status))).map((a) => ({ s: hm(String(a.data.startTime)), e: hm(String(a.data.startTime)) + Number(a.data.blockMin) }));
const onTimeOff = (ctx: HookCtx, staffId: string, date: string) => ctx.find('timeOff', { staffId }).some((t) => String(t.data.fromDate) <= date && date <= String(t.data.toDate));
const canDo = (st: RecordRow, serviceId: string) => ((st.data.skills as { serviceId: string }[] | undefined) ?? []).some((x) => x.serviceId === serviceId);

/** Throws the first violated booking rule (order matters: it is the order users see). */
function validateSlot(ctx: HookCtx, d: { serviceId: string; staffId: string; date: string; startTime: string; excludeId?: string }) {
  const svc = ctx.get(d.serviceId)!; const st = ctx.get(d.staffId)!;
  if (svc.data.active === false) ctx.fail(409, 'NOT_AVAILABLE', 'This service is not available');
  if (minutesUntilLocal(ctx, d.date, d.startTime) < 0) ctx.fail(409, 'PAST_DATE', 'The appointment time is in the past');
  if (!canDo(st, d.serviceId)) ctx.fail(409, 'STAFF_CANNOT_PERFORM', 'This staff member does not perform this service');
  if (st.data.active === false) ctx.fail(409, 'STAFF_INACTIVE', 'This staff member is not available');
  if (onTimeOff(ctx, d.staffId, d.date)) ctx.fail(409, 'STAFF_OFF', 'The staff member is off on this date');
  const dur = Number(svc.data.durationMin), block = dur + Number(svc.data.bufferMin ?? 0), s = hm(d.startTime), wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
  if (!ctx.find('schedule', { staffId: d.staffId }).some((w) => Number(w.data.weekday) === wd && hm(String(w.data.from)) <= s && s + dur <= hm(String(w.data.to)))) ctx.fail(409, 'OUTSIDE_SCHEDULE', 'The staff member does not work at this time');
  if (blocksFor(ctx, d.staffId, d.date, d.excludeId).some((b) => s < b.e && b.s < s + block)) ctx.fail(409, 'SLOT_TAKEN', 'This time slot is already booked');
  return { svc, dur, block, endTime: fmt(s + dur) };
}
/** Free start times (15-minute grid) per staff member for a service on a date. */
export function computeSlots(ctx: HookCtx, serviceId: string, date: string, staffId?: string, excludeId?: string) {
  const svc = ctx.get(serviceId)!; const dur = Number(svc.data.durationMin), block = dur + Number(svc.data.bufferMin ?? 0); const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const out: { staffId: string; staffName: string; slots: string[] }[] = [];
  for (const st of ctx.find('staff', {})) {
    if (staffId && st.id !== staffId) continue;
    if (st.data.active === false || !canDo(st, serviceId) || onTimeOff(ctx, st.id, date)) continue;
    const busy = blocksFor(ctx, st.id, date, excludeId); const slots: string[] = [];
    for (const w of ctx.find('schedule', { staffId: st.id }).filter((x) => Number(x.data.weekday) === wd)) {
      for (let s = hm(String(w.data.from)); s + dur <= hm(String(w.data.to)); s += 15)
        if (minutesUntilLocal(ctx, date, fmt(s)) >= 0 && !busy.some((b) => s < b.e && b.s < s + block) && !slots.includes(fmt(s))) slots.push(fmt(s));
    }
    if (slots.length) out.push({ staffId: st.id, staffName: String(st.data.name), slots: slots.sort() });
  }
  return out;
}
function feeFor(ctx: HookCtx, d: { date: string; startTime: string; price: number }, kind: 'cancel' | 'no_show') {
  const p = ctx.find('policy', { active: true }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; if (!p) return 0;
  if (kind === 'no_show') return applyBasisPoints(d.price, Number(p.data.noShowFeeBp ?? 0));
  const hours = minutesUntilLocal(ctx, d.date, d.startTime) / 60;
  return hours < Number(p.data.freeCancelHours ?? 24) ? applyBasisPoints(d.price, Number(p.data.lateFeeBp ?? 0)) : 0;
}

const NEXT: Record<string, string[]> = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled', 'no_show'] };
const appointment: EntityDef = { key: 'appointment', module: 'appointments', labelEn: 'Appointment', labelAr: 'حجز', titleField: '$code', subtitleField: 'date', autoCode: 'BK-', searchFields: ['date'], noDelete: true,
  filterable: ['status', 'date', 'staffId', 'customerId', 'serviceId', 'branchId', 'paymentStatus'], defaultSort: { field: 'date', dir: 'desc' }, immutableWhen: { field: 'status', values: ['completed', 'cancelled', 'no_show'] },
  fields: { customerId: { type: 'ref', entity: 'customer', required: true }, serviceId: { type: 'ref', entity: 'service', required: true }, staffId: { type: 'ref', entity: 'staff', required: true }, branchId: { type: 'ref', entity: 'branch' },
    date: { type: 'date', required: true }, startTime: { type: 'time', required: true }, status: { type: 'enum', values: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'], default: 'pending' }, notes: { type: 'text' },
    endTime: { type: 'time', readonly: true }, durationMin: { type: 'int', readonly: true }, blockMin: { type: 'int', readonly: true }, price: { type: 'money', readonly: true }, paidAmount: { type: 'money', readonly: true },
    paymentStatus: { type: 'enum', values: ['unpaid', 'partial', 'paid', 'partially_refunded', 'refunded'], readonly: true }, cancelFee: { type: 'money', readonly: true }, refundedAmount: { type: 'money', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const v = validateSlot(ctx, data as never); const svc = v.svc;
      return { ...data, status: 'pending', endTime: v.endTime, durationMin: v.dur, blockMin: v.block, price: Number(svc.data.price), paidAmount: 0, paymentStatus: 'unpaid', cancelFee: 0, refundedAmount: 0 };
    }
    const e = existing!.data; const out: Record<string, unknown> = { ...e };
    for (const k of ['status', 'notes', 'date', 'startTime', 'staffId']) if (k in data) out[k] = data[k];
    const prev = String(e.status), next = String(out.status);
    if (next !== prev) {
      if (!NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change booking from ${prev} to ${next}`);
      if (next === 'cancelled') out.cancelFee = feeFor(ctx, { date: String(e.date), startTime: String(e.startTime), price: Number(e.price) }, 'cancel');
      if (next === 'no_show') out.cancelFee = feeFor(ctx, { date: String(e.date), startTime: String(e.startTime), price: Number(e.price) }, 'no_show');
    }
    if (ACTIVE.includes(next) && (out.date !== e.date || out.startTime !== e.startTime || out.staffId !== e.staffId)) {
      const v = validateSlot(ctx, { serviceId: String(e.serviceId), staffId: String(out.staffId), date: String(out.date), startTime: String(out.startTime), excludeId: existing!.id });
      out.endTime = v.endTime; out.blockMin = v.block;
    }
    return out;
  } };
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true, filterable: ['appointmentId', 'method'],
  fields: { appointmentId: { type: 'ref', entity: 'appointment', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer', 'wallet'], required: true }, paidAt: { type: 'datetime' } },
  beforeSave: (ctx, { data }) => {
    const a = ctx.get(String(data.appointmentId))!; const due = ['cancelled', 'no_show'].includes(String(a.data.status)) ? Number(a.data.cancelFee) : Number(a.data.price);
    if (due === 0) ctx.fail(409, 'NOT_PAYABLE', 'Nothing is due for this booking');
    if (Number(data.amount) > due - Number(a.data.paidAmount)) ctx.fail(409, 'OVERPAYMENT', 'Payment exceeds the outstanding balance');
    return { ...data, paidAt: data.paidAt ?? ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => {
    const a = ctx.get(String(record.data.appointmentId))!; const due = ['cancelled', 'no_show'].includes(String(a.data.status)) ? Number(a.data.cancelFee) : Number(a.data.price);
    const paid = Number(a.data.paidAmount) + Number(record.data.amount); ctx.patch(a.id, { paidAmount: paid, paymentStatus: paid >= due ? 'paid' : 'partial' });
  } };

/** Money returned to a customer after a cancellation / no-show. The retained cancellation fee is never refunded; total refunds can never exceed what was paid. Records are immutable and audited. */
const refund: EntityDef = { key: 'refund', module: 'refunds', labelEn: 'Refund', labelAr: 'استرداد', titleField: '$code', subtitleField: 'method', autoCode: 'RF-', noUpdate: true, noDelete: true, filterable: ['appointmentId', 'method'],
  fields: { appointmentId: { type: 'ref', entity: 'appointment', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer', 'wallet'], required: true }, reason: { type: 'text', required: true, max: 500 }, refundedAt: { type: 'datetime' } },
  beforeSave: (ctx, { data }) => {
    const a = ctx.get(String(data.appointmentId))!;
    if (!['cancelled', 'no_show'].includes(String(a.data.status))) ctx.fail(409, 'NOT_REFUNDABLE', 'Only a cancelled or no-show booking can be refunded; cancel it first');
    const refundable = Math.max(0, Number(a.data.paidAmount ?? 0) - Number(a.data.cancelFee ?? 0) - Number(a.data.refundedAmount ?? 0));
    if (Number(data.amount) > refundable) ctx.fail(409, 'OVER_REFUND', `At most ${refundable} can still be refunded (paid minus the retained cancellation fee minus earlier refunds)`);
    return { ...data, refundedAt: data.refundedAt ?? ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => {
    const a = ctx.get(String(record.data.appointmentId))!; const total = Number(a.data.refundedAmount ?? 0) + Number(record.data.amount);
    ctx.patch(a.id, { refundedAmount: total, paymentStatus: total >= Number(a.data.paidAmount) ? 'refunded' : 'partially_refunded' });
  } };

const custFields = { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' } } as const;
export const booking: ProductDef = {
  slug: 'booking',
  entities: [branch, serviceCategory, service, staff, schedule, timeOff, customer, policy, appointment, payment, refund],
  kpis: [
    { key: 'appointmentsToday', labelEn: 'Bookings today', labelAr: 'حجوزات اليوم', entity: 'appointment', agg: 'count', period: 'today', dateField: 'date' },
    { key: 'pendingConfirmations', labelEn: 'Pending confirmations', labelAr: 'حجوزات بانتظار التأكيد', entity: 'appointment', agg: 'count', where: { status: 'pending' } },
    { key: 'customers', labelEn: 'Customers', labelAr: 'العملاء', entity: 'customer', agg: 'count' },
    { key: 'refundsMonth', labelEn: 'Refunds this month', labelAr: 'مبالغ مستردة هذا الشهر', entity: 'refund', agg: 'sum', field: 'amount', period: 'month', dateField: 'refundedAt', money: true },
    { key: 'revenueMonth', labelEn: 'Revenue this month', labelAr: 'إيراد الشهر', entity: 'payment', agg: 'sum', field: 'amount', period: 'month', dateField: 'paidAt', money: true },
  ],
  reports: [
    { key: 'appointmentsByStatus', labelEn: 'Bookings by status', labelAr: 'الحجوزات حسب الحالة', entity: 'appointment', groupBy: 'status', agg: 'count' },
    { key: 'appointmentsByStaff', labelEn: 'Bookings by staff', labelAr: 'الحجوزات حسب الموظف', entity: 'appointment', groupBy: 'staffId', agg: 'count' },
    { key: 'bookingsByService', labelEn: 'Bookings by service', labelAr: 'الحجوزات حسب الخدمة', entity: 'appointment', groupBy: 'serviceId', agg: 'count' },
    { key: 'revenueByMethod', labelEn: 'Revenue by payment method', labelAr: 'الإيراد حسب طريقة الدفع', entity: 'payment', groupBy: 'method', agg: 'sum', field: 'amount' },
  ],
  publicForms: [],
  publicActions: [
    { key: 'availability', method: 'GET', write: false, handler: (ctx, q) => {
      const svc = ctx.get(String(q.serviceId ?? '')); if (!svc || svc.entityType !== 'service' || svc.data.active === false) ctx.fail(404, 'NOT_FOUND', 'Service not found');
      const date = String(q.date ?? ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) ctx.fail(400, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD');
      // when the caller proves ownership of a booking (code + phone), that booking's own block is not counted as busy (used for rescheduling)
      const own = q.code ? ctx.byCode('appointment', String(q.code).toUpperCase()) : undefined; const ownCust = own && ctx.get(String(own.data.customerId));
      const excludeId = own && ownCust && ownCust.data.phone === normPhone(q.phone) ? own.id : undefined;
      return computeSlots(ctx, svc!.id, date, q.staffId ? String(q.staffId) : undefined, excludeId);
    } },
    { key: 'reschedule', method: 'POST', write: true, status: 200, handler: (ctx, b) => {
      const a = ctx.byCode('appointment', String(b.code ?? '').toUpperCase()); const c = a && ctx.get(String(a.data.customerId));
      if (!a || !c || c.data.phone !== normPhone(b.phone)) ctx.fail(404, 'NOT_FOUND', 'Booking not found');
      if (!ACTIVE.includes(String(a!.data.status))) ctx.fail(409, 'NOT_RESCHEDULABLE', 'This booking can no longer be rescheduled');
      const pol = ctx.find('policy', { active: true }).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
      const hoursLeft = minutesUntilLocal(ctx, String(a!.data.date), String(a!.data.startTime)) / 60;
      if (pol && hoursLeft < Number(pol.data.freeCancelHours ?? 0)) ctx.fail(409, 'TOO_LATE_TO_CHANGE', 'This booking is too close to its start time to be rescheduled online');
      const date = String(b.date ?? ''), time = String(b.startTime ?? ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) ctx.fail(400, 'VALIDATION_ERROR', 'date and startTime are required');
      const staffId = b.staffId ? String(b.staffId) : String(a!.data.staffId);
      const v = validateSlot(ctx, { serviceId: String(a!.data.serviceId), staffId, date, startTime: time, excludeId: a!.id });
      ctx.patch(a!.id, { date, startTime: time, staffId, endTime: v.endTime, blockMin: v.block });
      notifyTenant(ctx.db, ctx.tenantId, 'booking', `Booking ${a!.code} rescheduled`, `${c!.data.name} — ${date} ${time}`);
      return { code: a!.code, status: a!.data.status, date, startTime: time, endTime: v.endTime, staffName: ctx.get(staffId)!.data.name };
    } },
    { key: 'book', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
      const svc = ctx.get(String(b.serviceId ?? '')); if (!svc || svc.entityType !== 'service') ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown service');
      const v = validateData({ fields: custFields }, b.customer, { partial: false }); if (Object.keys(v.errors).length) ctx.fail(400, 'VALIDATION_ERROR', Object.entries(v.errors).map(([k, m]) => `${k} ${m}`).join('; '));
      const date = String(b.date), time = String(b.startTime);
      let staffId = b.staffId ? String(b.staffId) : undefined;
      if (!staffId) staffId = computeSlots(ctx, svc!.id, date).find((s) => s.slots.includes(time))?.staffId;
      if (!staffId) ctx.fail(409, 'NO_AVAILABILITY', 'No staff member is available at this time');
      const cust = ctx.find('customer', { phone: v.data.phone })[0] ?? ctx.createFull('customer', v.data);
      const a = ctx.createFull('appointment', { customerId: cust.id, serviceId: svc!.id, staffId, date, startTime: time, branchId: b.branchId });
      enqueue(ctx.db, ctx.tenantId, 'sms', String(cust.data.phone), 'booking_created', { code: a.code, name: cust.data.name, date, time });
      notifyTenant(ctx.db, ctx.tenantId, 'booking', `New booking ${a.code}`, `${cust.data.name} — ${date} ${time}`);
      return { code: a.code, status: a.data.status, price: a.data.price, staffName: ctx.get(staffId!)!.data.name, date, startTime: time, endTime: a.data.endTime };
    } },
    { key: 'status', method: 'GET', write: false, handler: (ctx, q) => {
      const a = ctx.byCode('appointment', String(q.code ?? '').toUpperCase()); const c = a && ctx.get(String(a.data.customerId));
      if (!a || !c || c.data.phone !== normPhone(q.phone)) ctx.fail(404, 'NOT_FOUND', 'Booking not found');
      return { code: a!.code, status: a!.data.status, date: a!.data.date, startTime: a!.data.startTime, endTime: a!.data.endTime, service: ctx.get(String(a!.data.serviceId))!.data.name, price: a!.data.price, paymentStatus: a!.data.paymentStatus, cancelFee: a!.data.cancelFee };
    } },
    { key: 'cancel', method: 'POST', write: true, status: 200, handler: (ctx, b) => {
      const a = ctx.byCode('appointment', String(b.code ?? '').toUpperCase()); const c = a && ctx.get(String(a.data.customerId));
      if (!a || !c || c.data.phone !== normPhone(b.phone)) ctx.fail(404, 'NOT_FOUND', 'Booking not found');
      if (!ACTIVE.includes(String(a!.data.status))) ctx.fail(409, 'NOT_CANCELLABLE', 'This booking can no longer be cancelled');
      const cancelFee = feeFor(ctx, { date: String(a!.data.date), startTime: String(a!.data.startTime), price: Number(a!.data.price) }, 'cancel');
      ctx.patch(a!.id, { status: 'cancelled', cancelFee });
      // what the business owes back (paid minus the retained fee). The customer is told, and staff record the refund: it is never automatic or silent.
      return { code: a!.code, status: 'cancelled', cancelFee, refundDue: Math.max(0, Number(a!.data.paidAmount ?? 0) - cancelFee) };
    } },
  ],
  employeeModules: { appointments: ['read', 'create', 'update'], bookingCustomers: ['read', 'create', 'update'], services: ['read'], staffMembers: ['read'], serviceCategories: ['read'], branches: ['read'], payments: ['read', 'create'] },
};
export type { Slot };
