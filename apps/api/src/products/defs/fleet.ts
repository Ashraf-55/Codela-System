import { applyBasisPoints } from '@codela/shared';
import { latinDigits, type EntityDef, type HookCtx, type ProductDef } from '../framework';

const normPhone = (p: unknown) => latinDigits(String(p ?? '')).replace(/[\s\-().]/g, '');
const today = (ctx: HookCtx) => ctx.now.toISOString().slice(0, 10);

const branch: EntityDef = { key: 'branch', module: 'branches', labelEn: 'Branch', labelAr: 'فرع', titleField: 'name', searchFields: ['name', 'address'], filterable: ['active'],
  fields: { name: { type: 'string', required: true }, address: { type: 'string' }, phone: { type: 'phone' }, active: { type: 'bool', default: true } }, public: { fields: ['name', 'address', 'phone'], filter: { active: true } } };
const customer: EntityDef = { key: 'customer', module: 'fleetCustomers', labelEn: 'Customer', labelAr: 'عميل', titleField: 'name', subtitleField: '$code', autoCode: 'CU-', searchFields: ['name', 'phone', 'email', 'company'],
  fields: { name: { type: 'string', required: true }, company: { type: 'string' }, phone: { type: 'phone', required: true, unique: true }, email: { type: 'email' }, address: { type: 'string' } } };
const driver: EntityDef = { key: 'driver', module: 'drivers', labelEn: 'Driver', labelAr: 'سائق', titleField: 'name', searchFields: ['name', 'phone', 'licenseNo'], filterable: ['active', 'branchId'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, licenseNo: { type: 'string', max: 40 }, licenseExpiry: { type: 'date' }, branchId: { type: 'ref', entity: 'branch' }, active: { type: 'bool', default: true },
    userId: { type: 'string', readonly: true } } }; // login account (driver portal), set by the owner through /tenant/fleet/driver-accounts
const fleetVehicle: EntityDef = { key: 'fleetVehicle', module: 'fleetVehicles', labelEn: 'Vehicle', labelAr: 'مركبة', titleField: 'plate', searchFields: ['plate', 'plateSearch'], filterable: ['status', 'type'],
  fields: { plate: { type: 'string', required: true, unique: true, max: 20 }, plateSearch: { type: 'string', readonly: true }, type: { type: 'enum', values: ['bike', 'car', 'van', 'truck'], required: true }, capacityKg: { type: 'int', min: 1, max: 100000, required: true },
    status: { type: 'enum', values: ['active', 'maintenance', 'retired'], default: 'active' } },
  beforeSave: (_c, { data }) => { const plate = String(data.plate).trim().replace(/\s+/g, ' ').toUpperCase(); return { ...data, plate, plateSearch: plate.replace(/\s+/g, '').toLowerCase() }; } };

const shippingFeeRule: EntityDef = { key: 'shippingFeeRule', module: 'rates', labelEn: 'Shipping rate', labelAr: 'تعرفة شحن', titleField: 'name', searchFields: ['name'], filterable: ['serviceType', 'active'],
  fields: { name: { type: 'string', required: true }, serviceType: { type: 'enum', values: ['standard', 'express', 'same_day'], required: true }, baseFee: { type: 'money', required: true }, perKgFee: { type: 'money', required: true },
    includedKg: { type: 'int', min: 1, max: 1000, default: 1 }, codFeeBp: { type: 'int', min: 0, max: 10000, default: 0 }, active: { type: 'bool', default: true } },
  beforeSave: (ctx, { data, existing }) => {
    if (data.active !== false && ctx.find('shippingFeeRule', { serviceType: data.serviceType, active: true }).some((r) => r.id !== existing?.id)) ctx.fail(409, 'RATE_EXISTS', 'An active rate already exists for this service type');
  },
  public: { fields: ['name', 'serviceType', 'baseFee', 'perKgFee', 'includedKg'], filter: { active: true } } };
function computeFee(ctx: HookCtx, d: { serviceType: unknown; weightGrams: unknown; codAmount?: unknown }) {
  const r = ctx.find('shippingFeeRule', { serviceType: d.serviceType, active: true })[0]; if (!r) ctx.fail(409, 'NO_RATE', 'No active rate for this service type');
  const kg = Math.ceil(Number(d.weightGrams) / 1000); const extra = Math.max(0, kg - Number(r!.data.includedKg ?? 1));
  const fee = Number(r!.data.baseFee) + extra * Number(r!.data.perKgFee); const cod = Number(d.codAmount ?? 0);
  const codFee = cod > 0 ? applyBasisPoints(cod, Number(r!.data.codFeeBp ?? 0)) : 0;
  return { fee, codFee, total: fee + codFee };
}

const trackingEvent: EntityDef = { key: 'trackingEvent', module: 'tracking', labelEn: 'Tracking event', labelAr: 'حدث تتبع', titleField: 'status', noCreate: true, noUpdate: true, noDelete: true, filterable: ['shipmentId', 'status'],
  fields: { shipmentId: { type: 'ref', entity: 'shipment', readonly: true }, status: { type: 'string', readonly: true }, note: { type: 'string', readonly: true }, at: { type: 'datetime', readonly: true }, seq: { type: 'int', readonly: true } } };
const event = (ctx: HookCtx, shipmentId: string, status: string, note?: string) =>
  ctx.create('trackingEvent', { shipmentId, status, ...(note ? { note } : {}), at: ctx.now.toISOString(), seq: ctx.find('trackingEvent', { shipmentId }).length + 1 });
const ACTIVE_A = ['assigned', 'accepted'];
const activeAssignments = (ctx: HookCtx, shipmentId: string) => ctx.find('assignment', { shipmentId }).filter((a) => ACTIVE_A.includes(String(a.data.status)));

const S_NEXT: Record<string, string[]> = { created: ['picked_up', 'cancelled'], picked_up: ['at_hub', 'out_for_delivery'], at_hub: ['out_for_delivery', 'returned'], out_for_delivery: ['delivered', 'failed_attempt'], failed_attempt: ['out_for_delivery', 'returned'] };
const EDITABLE = ['status', 'recipientName', 'recipientPhone', 'recipientAddress', 'recipientCity', 'notes', 'failureReason'];
const shipment: EntityDef = { key: 'shipment', module: 'shipments', labelEn: 'Shipment', labelAr: 'شحنة', titleField: '$code', subtitleField: 'status', autoCode: 'SH-', noDelete: true,
  searchFields: ['recipientName', 'recipientPhone', 'recipientCity', 'description'], filterable: ['status', 'serviceType', 'senderId', 'branchId', 'driverId', 'createdDate'],
  immutableWhen: { field: 'status', values: ['delivered', 'returned', 'cancelled'] },
  fields: { senderId: { type: 'ref', entity: 'customer', required: true }, branchId: { type: 'ref', entity: 'branch' }, recipientName: { type: 'string', required: true }, recipientPhone: { type: 'phone', required: true }, recipientAddress: { type: 'string', required: true },
    recipientCity: { type: 'string', required: true }, serviceType: { type: 'enum', values: ['standard', 'express', 'same_day'], required: true }, weightGrams: { type: 'int', min: 1, max: 2_000_000, required: true },
    description: { type: 'string' }, codAmount: { type: 'money', default: 0 }, notes: { type: 'text' }, failureReason: { type: 'string', max: 300 },
    status: { type: 'enum', values: ['created', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered', 'failed_attempt', 'returned', 'cancelled'], default: 'created' },
    fee: { type: 'money', readonly: true }, codFee: { type: 'money', readonly: true }, attempts: { type: 'int', readonly: true }, driverId: { type: 'ref', entity: 'driver', readonly: true }, vehicleId: { type: 'ref', entity: 'fleetVehicle', readonly: true },
    createdDate: { type: 'date', readonly: true }, deliveredAt: { type: 'datetime', readonly: true }, deliveredDate: { type: 'date', readonly: true },
    // proof of delivery, written by the driver portal only
    proofName: { type: 'string', readonly: true }, proofNote: { type: 'text', readonly: true }, proofFileId: { type: 'string', readonly: true }, collectedAmount: { type: 'money', readonly: true }, lastLocation: { type: 'string', readonly: true, max: 40 }, lastLocationAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') { const f = computeFee(ctx, data as { serviceType: unknown; weightGrams: unknown; codAmount?: unknown }); return { ...data, status: 'created', fee: f.fee, codFee: f.codFee, attempts: 0, createdDate: today(ctx) }; }
    const out: Record<string, unknown> = { ...existing!.data }; for (const k of EDITABLE) if (k in data) out[k] = data[k];
    const prev = String(existing!.data.status), next = String(out.status);
    if (next !== prev) {
      if (!S_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change shipment from ${prev} to ${next}`);
      if (next === 'out_for_delivery' && !existing!.data.driverId) ctx.fail(409, 'NOT_DISPATCHED', 'Assign a driver before sending the shipment out for delivery');
      if (next === 'failed_attempt') out.attempts = Number(existing!.data.attempts ?? 0) + 1;
      if (next === 'delivered') { out.deliveredAt = ctx.now.toISOString(); out.deliveredDate = today(ctx); }
    }
    return out;
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create') return void event(ctx, record.id, 'created');
    const d = record.data; if (d.status === previous!.data.status) return;
    event(ctx, record.id, String(d.status), d.status === 'failed_attempt' && d.failureReason ? String(d.failureReason) : undefined);
    const closeAssignments = (to: string) => activeAssignments(ctx, record.id).forEach((a) => ctx.patch(a.id, { status: to }));
    if (d.status === 'delivered') {
      closeAssignments('completed');
      if (Number(d.codAmount) > 0) ctx.create('cashCollection', { shipmentId: record.id, driverId: d.driverId, amount: d.codAmount, status: 'collected', collectedAt: ctx.now.toISOString() });
    } else if (d.status === 'returned') closeAssignments('completed');
    else if (d.status === 'cancelled') closeAssignments('cancelled');
    else if (d.status === 'failed_attempt' && Number(d.attempts) >= 3) { ctx.patch(record.id, { status: 'returned' }); event(ctx, record.id, 'returned', 'Maximum delivery attempts reached'); closeAssignments('completed'); }
  } };

const A_NEXT: Record<string, string[]> = { assigned: ['accepted', 'cancelled'], accepted: ['cancelled'] };
const assignment: EntityDef = { key: 'assignment', module: 'dispatch', labelEn: 'Dispatch assignment', labelAr: 'تكليف توصيل', titleField: '$code', subtitleField: 'status', autoCode: 'AS-', noDelete: true, filterable: ['shipmentId', 'driverId', 'vehicleId', 'status'],
  immutableWhen: { field: 'status', values: ['completed', 'cancelled'] },
  fields: { shipmentId: { type: 'ref', entity: 'shipment', required: true }, driverId: { type: 'ref', entity: 'driver', required: true }, vehicleId: { type: 'ref', entity: 'fleetVehicle' },
    status: { type: 'enum', values: ['assigned', 'accepted', 'completed', 'cancelled'], default: 'assigned' } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const s = ctx.get(String(data.shipmentId))!;
      if (!['created', 'picked_up', 'at_hub', 'failed_attempt'].includes(String(s.data.status))) ctx.fail(409, 'NOT_DISPATCHABLE', 'This shipment cannot be dispatched in its current state');
      if (activeAssignments(ctx, s.id).length) ctx.fail(409, 'ALREADY_ASSIGNED', 'The shipment already has an active assignment');
      const d = ctx.get(String(data.driverId))!;
      if (d.data.active === false) ctx.fail(409, 'DRIVER_INACTIVE', 'The driver is not active');
      if (d.data.licenseExpiry && String(d.data.licenseExpiry) < today(ctx)) ctx.fail(409, 'LICENSE_EXPIRED', "The driver's licence has expired");
      if (data.vehicleId) {
        const v = ctx.get(String(data.vehicleId))!; if (v.data.status !== 'active') ctx.fail(409, 'VEHICLE_UNAVAILABLE', 'The vehicle is not available');
        const load = ctx.find('assignment', { vehicleId: v.id }).filter((a) => ACTIVE_A.includes(String(a.data.status))).reduce((t, a) => t + Number(ctx.get(String(a.data.shipmentId))!.data.weightGrams), 0);
        if (load + Number(s.data.weightGrams) > Number(v.data.capacityKg) * 1000) ctx.fail(409, 'OVER_CAPACITY', 'The vehicle capacity would be exceeded');
      }
      return { ...data, status: 'assigned' };
    }
    const next = String(data.status); const prev = String(existing!.data.status);
    if (next !== prev) {
      if (!A_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change assignment from ${prev} to ${next}`);
      if (next === 'cancelled' && ctx.get(String(existing!.data.shipmentId))!.data.status === 'out_for_delivery') ctx.fail(409, 'CANNOT_CANCEL_IN_TRANSIT', 'The shipment is already out for delivery');
    }
    return { ...existing!.data, status: next };
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create') { ctx.patch(String(record.data.shipmentId), { driverId: record.data.driverId, vehicleId: record.data.vehicleId ?? null }); return void event(ctx, String(record.data.shipmentId), 'assigned'); }
    if (record.data.status === 'cancelled' && previous!.data.status !== 'cancelled') { ctx.patch(String(record.data.shipmentId), { driverId: null, vehicleId: null }); event(ctx, String(record.data.shipmentId), 'unassigned'); }
  } };

const cashCollection: EntityDef = { key: 'cashCollection', module: 'collections', labelEn: 'Cash collection', labelAr: 'تحصيل نقدي', titleField: '$code', subtitleField: 'status', autoCode: 'CC-', noCreate: true, noDelete: true, filterable: ['status', 'driverId'],
  immutableWhen: { field: 'status', values: ['settled'] },
  fields: { shipmentId: { type: 'ref', entity: 'shipment', readonly: true, unique: true }, driverId: { type: 'ref', entity: 'driver', readonly: true }, amount: { type: 'money', readonly: true },
    status: { type: 'enum', values: ['collected', 'settled'], default: 'collected' }, collectedAt: { type: 'datetime', readonly: true }, settledAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { data, existing }) => (data.status === 'settled' ? { ...existing!.data, status: 'settled', settledAt: ctx.now.toISOString() } : existing!.data) };
const fleetExpense: EntityDef = { key: 'fleetExpense', module: 'fleetExpenses', labelEn: 'Fleet expense', labelAr: 'مصروف أسطول', titleField: '$code', subtitleField: 'type', autoCode: 'FX-', noUpdate: true, noDelete: true, filterable: ['vehicleId', 'driverId', 'type', 'date'],
  fields: { vehicleId: { type: 'ref', entity: 'fleetVehicle', required: true }, driverId: { type: 'ref', entity: 'driver' }, type: { type: 'enum', values: ['fuel', 'maintenance', 'toll', 'fine', 'other'], required: true }, amount: { type: 'money', min: 1, required: true }, date: { type: 'date', required: true }, note: { type: 'string' } } };
const shippingRequest: EntityDef = { key: 'shippingRequest', module: 'shippingRequests', labelEn: 'Shipping request', labelAr: 'طلب شحن', titleField: 'name', searchFields: ['name', 'phone'], filterable: ['status'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, pickupAddress: { type: 'string', required: true }, dropAddress: { type: 'string', required: true }, weightGrams: { type: 'int', min: 1, max: 2_000_000 },
    serviceType: { type: 'enum', values: ['standard', 'express', 'same_day'] }, description: { type: 'string' }, status: { type: 'enum', values: ['new', 'converted', 'rejected'], default: 'new' } } };
const inquiry: EntityDef = { key: 'inquiry', module: 'inquiries', labelEn: 'Inquiry', labelAr: 'استفسار', titleField: 'name', searchFields: ['name', 'phone', 'message'], filterable: ['status'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' }, message: { type: 'text', required: true }, status: { type: 'enum', values: ['new', 'handled'], default: 'new' } } };

/** Delivery areas: managed in the dashboard and shown on the public site as the coverage areas. */
const area: EntityDef = { key: 'area', module: 'areas', labelEn: 'Delivery area', labelAr: 'منطقة توصيل', titleField: 'name', subtitleField: 'governorate', searchFields: ['name', 'governorate'], filterable: ['active', 'governorate'],
  fields: { name: { type: 'string', required: true, unique: true, max: 120 }, governorate: { type: 'string', max: 80 }, estimatedDays: { type: 'int', min: 0, max: 60 }, notes: { type: 'text' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'governorate', 'estimatedDays'], filter: { active: true } } };
function invoiceTotals(ctx: HookCtx, data: Record<string, unknown>) {
  const lines = (data.lines as { qty?: number; unitPrice: number }[]) ?? []; const subtotal = lines.reduce((a, l) => a + (l.qty ?? 1) * l.unitPrice, 0);
  const discount = Number(data.discount ?? 0); if (discount > subtotal) ctx.fail(400, 'VALIDATION_ERROR', 'discount cannot exceed the subtotal');
  const tax = applyBasisPoints(subtotal - discount, Number(data.taxBp ?? 0));
  return { ...data, subtotal, tax, total: subtotal - discount + tax };
}
/** Customer invoices (shipping charges). Totals are server-side; issued invoices only accept payments or an unpaid cancellation. */
const invoice: EntityDef = { key: 'invoice', module: 'invoices', labelEn: 'Invoice', labelAr: 'فاتورة', titleField: '$code', subtitleField: 'status', autoCode: 'INV-', noDelete: true, filterable: ['status', 'customerId', 'shipmentId'],
  immutableWhen: { field: 'status', values: ['paid', 'cancelled'] },
  fields: { customerId: { type: 'ref', entity: 'customer', required: true }, shipmentId: { type: 'ref', entity: 'shipment' }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 100, fields: { desc: { type: 'string', required: true }, qty: { type: 'int', min: 1, default: 1 }, unitPrice: { type: 'money', required: true } } },
    discount: { type: 'money', default: 0 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 }, status: { type: 'enum', values: ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'], default: 'draft' },
    subtotal: { type: 'money', readonly: true }, tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true }, paidAmount: { type: 'money', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') return { ...invoiceTotals(ctx, data), status: 'draft', paidAmount: 0 };
    const prev = String(existing!.data.status), next = String(data.status);
    if (prev !== 'draft') {
      const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(existing!.data[k]));
      if (changed.some((k) => k !== 'status') || (next !== prev && !(next === 'cancelled' && Number(existing!.data.paidAmount) === 0))) ctx.fail(409, 'IMMUTABLE', 'Issued invoices can only be cancelled (when unpaid)');
    } else if (!['draft', 'issued', 'cancelled'].includes(next)) ctx.fail(409, 'INVALID_TRANSITION', 'A draft invoice can only be issued or cancelled');
    return { ...invoiceTotals(ctx, data), paidAmount: existing!.data.paidAmount };
  } };
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true, filterable: ['invoiceId', 'method'],
  fields: { invoiceId: { type: 'ref', entity: 'invoice', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer', 'instapay', 'vodafone_cash'], required: true }, reference: { type: 'string', max: 80 }, paidAt: { type: 'datetime' } },
  beforeSave: (ctx, { data }) => {
    const inv = ctx.get(String(data.invoiceId))!;
    if (!['issued', 'partially_paid'].includes(String(inv.data.status))) ctx.fail(409, 'INVOICE_NOT_PAYABLE', 'Payments can only be recorded on issued invoices');
    if (Number(data.amount) > Number(inv.data.total) - Number(inv.data.paidAmount)) ctx.fail(409, 'OVERPAYMENT', 'Payment exceeds the outstanding balance');
    return { ...data, paidAt: data.paidAt ?? ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => { const inv = ctx.get(String(record.data.invoiceId))!; const paid = Number(inv.data.paidAmount) + Number(record.data.amount); ctx.patch(inv.id, { paidAmount: paid, status: paid >= Number(inv.data.total) ? 'paid' : 'partially_paid' }); } };

export const fleet: ProductDef = {
  slug: 'fleet',
  entities: [branch, customer, driver, fleetVehicle, shippingFeeRule, area, shipment, trackingEvent, assignment, cashCollection, fleetExpense, invoice, payment, shippingRequest, inquiry],
  kpis: [
    { key: 'shipmentsToday', labelEn: 'Shipments today', labelAr: 'شحنات اليوم', entity: 'shipment', agg: 'count', period: 'today', dateField: 'createdDate' },
    { key: 'inTransit', labelEn: 'In transit', labelAr: 'قيد النقل', entity: 'shipment', agg: 'count', where: { status: ['picked_up', 'at_hub', 'out_for_delivery'] } },
    { key: 'activeDrivers', labelEn: 'Active drivers', labelAr: 'سائقون نشطون', entity: 'driver', agg: 'count', where: { active: true } },
    { key: 'unsettledCash', labelEn: 'Unsettled cash', labelAr: 'نقدية غير مسوّاة', entity: 'cashCollection', agg: 'sum', field: 'amount', where: { status: 'collected' }, money: true },
  ],
  reports: [
    { key: 'shipmentsByStatus', labelEn: 'Shipments by status', labelAr: 'الشحنات حسب الحالة', entity: 'shipment', groupBy: 'status', agg: 'count' },
    { key: 'shipmentsByService', labelEn: 'Shipments by service', labelAr: 'الشحنات حسب الخدمة', entity: 'shipment', groupBy: 'serviceType', agg: 'count' },
    { key: 'deliveredByDriver', labelEn: 'Deliveries by driver', labelAr: 'التسليمات حسب السائق', entity: 'shipment', groupBy: 'driverId', agg: 'count', where: { status: 'delivered' } },
    { key: 'unsettledByDriver', labelEn: 'Unsettled cash by driver', labelAr: 'نقدية غير مسوّاة حسب السائق', entity: 'cashCollection', groupBy: 'driverId', agg: 'sum', field: 'amount', where: { status: 'collected' } },
    { key: 'expensesByType', labelEn: 'Expenses by type', labelAr: 'المصروفات حسب النوع', entity: 'fleetExpense', groupBy: 'type', agg: 'sum', field: 'amount' },
  ],
  publicForms: [{ key: 'shippingRequest', entity: 'shippingRequest', fields: ['name', 'phone', 'pickupAddress', 'dropAddress', 'weightGrams', 'serviceType', 'description'] }, { key: 'inquiry', entity: 'inquiry', fields: ['name', 'phone', 'email', 'message'] }],
  publicActions: [
    { key: 'quote', method: 'POST', write: false, handler: (ctx, b) => computeFee(ctx, { serviceType: b.serviceType, weightGrams: b.weightGrams, codAmount: b.codAmount }) },
    { key: 'track', method: 'GET', write: false, handler: (ctx, q) => {
      const s = ctx.byCode('shipment', String(q.code ?? '').toUpperCase()); const phone = normPhone(q.phone); const sender = s && ctx.get(String(s.data.senderId));
      if (!s || !phone || (s.data.recipientPhone !== phone && sender?.data.phone !== phone)) ctx.fail(404, 'NOT_FOUND', 'Shipment not found');
      const timeline = ctx.find('trackingEvent', { shipmentId: s!.id }).sort((a, b) => Number(a.data.seq) - Number(b.data.seq)).filter((e) => !['assigned', 'unassigned'].includes(String(e.data.status))).map((e) => ({ status: e.data.status, at: e.data.at }));
      return { code: s!.code, status: s!.data.status, serviceType: s!.data.serviceType, recipientCity: s!.data.recipientCity, createdDate: s!.data.createdDate, deliveredAt: s!.data.deliveredAt ?? null, timeline };
    } },
  ],
  employeeModules: { shipments: ['read', 'create', 'update'], fleetCustomers: ['read', 'create', 'update'], drivers: ['read'], fleetVehicles: ['read'], dispatch: ['read', 'create', 'update'], tracking: ['read'], collections: ['read'],
    shippingRequests: ['read', 'update'], inquiries: ['read', 'update'], branches: ['read'], rates: ['read'], areas: ['read'], invoices: ['read'] },
};
