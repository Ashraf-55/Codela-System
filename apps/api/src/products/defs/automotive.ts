import { applyBasisPoints } from '@codela/shared';
import { latinDigits, type EntityDef, type HookCtx, type ProductDef } from '../framework';

const customer: EntityDef = { key: 'customer', module: 'carCustomers', labelEn: 'Customer', labelAr: 'عميل', titleField: 'name', subtitleField: '$code', autoCode: 'CU-', searchFields: ['name', 'phone', 'email'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' }, notes: { type: 'text' } } };
const plateKey = (p: string) => p.replace(/\s+/g, '').toLowerCase();
const vehicle: EntityDef = { key: 'vehicle', module: 'vehicles', labelEn: 'Vehicle', labelAr: 'مركبة', titleField: 'plate', subtitleField: '$code', autoCode: 'VH-', searchFields: ['plate', 'plateSearch', 'vin', 'make', 'model'], filterable: ['customerId', 'make'],
  fields: { customerId: { type: 'ref', entity: 'customer', required: true }, plate: { type: 'string', required: true, unique: true, max: 20 }, plateSearch: { type: 'string', readonly: true }, make: { type: 'string', required: true }, model: { type: 'string', required: true },
    year: { type: 'int', min: 1950, max: 2100 }, vin: { type: 'string', max: 30 }, color: { type: 'string' }, odometer: { type: 'int', min: 0, default: 0 }, notes: { type: 'text' } },
  beforeSave: (_c, { data }) => { const plate = String(data.plate).trim().replace(/\s+/g, ' ').toUpperCase(); return { ...data, plate, plateSearch: plateKey(plate) }; } };
const service: EntityDef = { key: 'service', module: 'services', labelEn: 'Service', labelAr: 'خدمة', titleField: 'name', searchFields: ['name'], filterable: ['active'],
  fields: { name: { type: 'string', required: true, unique: true }, price: { type: 'money', required: true }, durationMin: { type: 'int', min: 5, max: 1440, default: 60 }, description: { type: 'text' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'price', 'durationMin', 'description'], filter: { active: true } } };
const technician: EntityDef = { key: 'technician', module: 'technicians', labelEn: 'Technician', labelAr: 'فني', titleField: 'name', searchFields: ['name', 'specialty'], filterable: ['active'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, specialty: { type: 'string' }, active: { type: 'bool', default: true } } };
const supplier: EntityDef = { key: 'supplier', module: 'suppliers', labelEn: 'Supplier', labelAr: 'مورد', titleField: 'name', searchFields: ['name', 'phone'],
  fields: { name: { type: 'string', required: true, unique: true }, phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' } } };
const sparePart: EntityDef = { key: 'sparePart', module: 'parts', labelEn: 'Spare part', labelAr: 'قطعة غيار', titleField: 'name', subtitleField: 'sku', searchFields: ['sku', 'name', 'brand', 'compatibility'], filterable: ['brand', 'active', 'supplierId', 'category'],
  fields: { category: { type: 'enum', values: ['part', 'battery', 'oil', 'tire', 'accessory'], default: 'part' }, sku: { type: 'string', required: true, unique: true, max: 60 }, name: { type: 'string', required: true }, brand: { type: 'string' }, compatibility: { type: 'text' }, price: { type: 'money', required: true }, cost: { type: 'money' },
    stock: { type: 'int', readonly: true }, reorderLevel: { type: 'int', min: 0 }, supplierId: { type: 'ref', entity: 'supplier' }, active: { type: 'bool', default: true } },
  beforeSave: (_c, { action, data, existing }) => ({ ...data, stock: action === 'create' ? 0 : existing!.data.stock }),
  public: { fields: ['sku', 'name', 'brand', 'compatibility', 'price', 'stock', 'category'], filter: { active: true }, filterable: ['brand', 'category'] } };
const PLUS = ['in', 'return', 'adjust_up'];
const partMovement: EntityDef = { key: 'partMovement', module: 'partStock', labelEn: 'Part movement', labelAr: 'حركة قطع', titleField: '$code', subtitleField: 'type', autoCode: 'PM-', noUpdate: true, noDelete: true, filterable: ['partId', 'type'],
  fields: { partId: { type: 'ref', entity: 'sparePart', required: true }, type: { type: 'enum', values: ['in', 'out', 'return', 'damaged', 'adjust_up', 'adjust_down'], required: true }, qty: { type: 'int', min: 1, required: true }, reason: { type: 'string' }, workOrderId: { type: 'ref', entity: 'workOrder' } },
  beforeSave: (ctx, { data }) => { const cur = Number(ctx.get(String(data.partId))!.data.stock ?? 0); if (!PLUS.includes(String(data.type)) && Number(data.qty) > cur) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${cur} in stock`); },
  afterSave: (ctx, { record }) => { const p = ctx.get(String(record.data.partId))!; ctx.patch(p.id, { stock: Number(p.data.stock ?? 0) + (PLUS.includes(String(record.data.type)) ? 1 : -1) * Number(record.data.qty) }); } };

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const A_NEXT: Record<string, string[]> = { scheduled: ['arrived', 'cancelled', 'no_show'], arrived: ['completed', 'cancelled'] };
const appointment: EntityDef = { key: 'appointment', module: 'appointments', labelEn: 'Maintenance appointment', labelAr: 'موعد صيانة', titleField: '$code', subtitleField: 'date', autoCode: 'AP-', searchFields: ['date'],
  filterable: ['status', 'date', 'vehicleId', 'technicianId'], defaultSort: { field: 'date', dir: 'desc' },
  fields: { vehicleId: { type: 'ref', entity: 'vehicle', required: true }, serviceId: { type: 'ref', entity: 'service' }, technicianId: { type: 'ref', entity: 'technician' }, date: { type: 'date', required: true }, startTime: { type: 'time', required: true },
    durationMin: { type: 'int', min: 5, max: 1440, default: 60 }, status: { type: 'enum', values: ['scheduled', 'arrived', 'completed', 'cancelled', 'no_show'], default: 'scheduled' }, notes: { type: 'text' } },
  beforeSave: (ctx, { action, data, existing }) => {
    const status = action === 'create' ? 'scheduled' : String(data.status);
    if (existing && status !== existing.data.status && !A_NEXT[String(existing.data.status)]?.includes(status)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change appointment from ${existing.data.status} to ${status}`);
    if (['scheduled', 'arrived'].includes(status)) {
      const s = hm(String(data.startTime)), e = s + Number(data.durationMin ?? 60);
      for (const o of ctx.find('appointment', { date: data.date })) {
        if (o.id === existing?.id || !['scheduled', 'arrived'].includes(String(o.data.status))) continue;
        const os = hm(String(o.data.startTime)), oe = os + Number(o.data.durationMin ?? 60);
        const same = o.data.vehicleId === data.vehicleId || (data.technicianId && o.data.technicianId === data.technicianId);
        if (same && s < oe && os < e) ctx.fail(409, 'SLOT_TAKEN', 'The technician or vehicle is already booked in this time slot');
      }
    }
    return { ...data, status };
  } };
const bookingRequest: EntityDef = { key: 'bookingRequest', module: 'bookingRequests', labelEn: 'Booking request', labelAr: 'طلب حجز', titleField: 'name', searchFields: ['name', 'phone', 'plate'], filterable: ['status', 'kind'],
  fields: { kind: { type: 'enum', values: ['booking', 'quote'], default: 'booking' }, partId: { type: 'ref', entity: 'sparePart' }, name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, plate: { type: 'string', max: 20 }, make: { type: 'string' }, model: { type: 'string' }, serviceId: { type: 'ref', entity: 'service' },
    preferredDate: { type: 'date' }, preferredTime: { type: 'time' }, message: { type: 'text' }, status: { type: 'enum', values: ['new', 'converted', 'rejected'], default: 'new' }, appointmentId: { type: 'ref', entity: 'appointment', readonly: true } },
  // converting a booking request creates the real appointment (needs a registered vehicle with that plate and a preferred date/time); the appointment's own rules (clashes, hours) still apply
  beforeSave: (ctx, { action, data, existing }) => {
    if (action !== 'update' || data.status !== 'converted' || existing?.data.status === 'converted') return;
    if (existing!.data.status !== 'new') ctx.fail(409, 'INVALID_TRANSITION', 'Only a new request can be converted');
    if (existing!.data.kind !== 'booking') return; // quote requests are only marked as handled
    const plate = String(existing!.data.plate ?? '').replace(/\s+/g, '').toLowerCase();
    if (!plate || !ctx.find('vehicle', { plateSearch: plate })[0]) ctx.fail(409, 'VEHICLE_NOT_FOUND', 'Register the customer vehicle (same plate) before converting this request');
    if (!existing!.data.preferredDate || !existing!.data.preferredTime) ctx.fail(409, 'VALIDATION_ERROR', 'The request has no preferred date and time');
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action !== 'update' || record.data.status !== 'converted' || previous?.data.status === 'converted' || record.data.kind !== 'booking') return;
    const plate = String(record.data.plate ?? '').replace(/\s+/g, '').toLowerCase(); const v = ctx.find('vehicle', { plateSearch: plate })[0]!;
    const a = ctx.createFull('appointment', { vehicleId: v.id, ...(record.data.serviceId ? { serviceId: record.data.serviceId } : {}), date: record.data.preferredDate, startTime: record.data.preferredTime, notes: `From booking request ${record.code ?? ''}`.trim() });
    ctx.patch(record.id, { appointmentId: a.id });
  } };

/** Branches of the workshop / store: shown on the public site and used in the dashboard. */
const branch: EntityDef = { key: 'branch', module: 'branches', labelEn: 'Branch', labelAr: 'فرع', titleField: 'name', searchFields: ['name', 'address'], filterable: ['active'],
  fields: { name: { type: 'string', required: true, unique: true }, address: { type: 'string' }, phone: { type: 'phone' }, hours: { type: 'string' }, mapUrl: { type: 'url' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'address', 'phone', 'hours', 'mapUrl'], filter: { active: true } } };
/** Supported makes and models, shown on the public site. */
const supportedMake: EntityDef = { key: 'supportedMake', module: 'supportedMakes', labelEn: 'Supported make', labelAr: 'ماركة مدعومة', titleField: 'make', searchFields: ['make', 'models'], filterable: ['active'],
  fields: { make: { type: 'string', required: true, unique: true }, models: { type: 'text' }, active: { type: 'bool', default: true } },
  public: { fields: ['make', 'models'], filter: { active: true } } };
/** Spare-part purchasing: totals are server-side; receiving a draft order adds every line to the part stock ledger exactly once and refreshes the part cost. */
const purchaseOrder: EntityDef = { key: 'purchaseOrder', module: 'purchasing', labelEn: 'Purchase order', labelAr: 'أمر شراء', titleField: '$code', subtitleField: 'status', autoCode: 'PO-', searchFields: ['reference'], noDelete: true,
  filterable: ['status', 'supplierId'], immutableWhen: { field: 'status', values: ['received', 'cancelled'] },
  fields: { supplierId: { type: 'ref', entity: 'supplier', required: true }, reference: { type: 'string', max: 60 }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 100, fields: { partId: { type: 'ref', entity: 'sparePart', required: true }, qty: { type: 'int', min: 1, required: true }, unitCost: { type: 'money', required: true } } },
    status: { type: 'enum', values: ['draft', 'received', 'cancelled'], default: 'draft' }, total: { type: 'money', readonly: true }, receivedAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') { const lines = data.lines as { qty: number; unitCost: number }[]; return { ...data, status: 'draft', total: lines.reduce((a, l) => a + l.qty * l.unitCost, 0) }; }
    const out: Record<string, unknown> = { ...existing!.data }; for (const k of ['status', 'notes', 'reference']) if (k in data) out[k] = data[k]; // lines and prices are fixed once created
    if (out.status !== existing!.data.status) {
      if (existing!.data.status !== 'draft') ctx.fail(409, 'INVALID_TRANSITION', 'Only a draft purchase order can be received or cancelled');
      if (out.status === 'received') out.receivedAt = ctx.now.toISOString();
    }
    return out;
  },
  afterSave: (ctx, { record, previous }) => {
    if (record.data.status === 'received' && previous && previous.data.status !== 'received')
      for (const l of record.data.lines as { partId: string; qty: number; unitCost: number }[]) { ctx.patch(l.partId, { cost: l.unitCost }); ctx.createFull('partMovement', { partId: l.partId, type: 'in', qty: l.qty, reason: `purchase ${record.code}` }); }
  } };
/** Warranty on a part or a service performed: the end date is computed from the start date and the months. */
const warranty: EntityDef = { key: 'warranty', module: 'warranties', labelEn: 'Warranty', labelAr: 'ضمان', titleField: '$code', subtitleField: 'status', autoCode: 'WAR-', searchFields: ['description'], filterable: ['status', 'kind', 'vehicleId', 'workOrderId'],
  fields: { kind: { type: 'enum', values: ['part', 'service'], required: true }, vehicleId: { type: 'ref', entity: 'vehicle', required: true }, workOrderId: { type: 'ref', entity: 'workOrder' }, partId: { type: 'ref', entity: 'sparePart' }, serviceId: { type: 'ref', entity: 'service' },
    description: { type: 'string', required: true, max: 200 }, startDate: { type: 'date', required: true }, months: { type: 'int', min: 1, max: 120, required: true }, endDate: { type: 'date', readonly: true },
    status: { type: 'enum', values: ['active', 'claimed', 'void'], default: 'active' }, claimNote: { type: 'text' } },
  beforeSave: (ctx, { action, data, existing }) => {
    const start = String(data.startDate ?? existing?.data.startDate); const months = Number(data.months ?? existing?.data.months);
    const d = new Date(`${start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months);
    if (action === 'update' && existing!.data.status !== 'active' && data.status !== undefined && data.status !== existing!.data.status) ctx.fail(409, 'INVALID_TRANSITION', 'A claimed or void warranty is final');
    if (data.kind === 'part' && !data.partId && action === 'create') ctx.fail(400, 'VALIDATION_ERROR', 'partId is required for a part warranty');
    if (data.kind === 'service' && !data.serviceId && action === 'create') ctx.fail(400, 'VALIDATION_ERROR', 'serviceId is required for a service warranty');
    return { ...data, endDate: d.toISOString().slice(0, 10) };
  } };


interface SItem { serviceId: string; name: string; qty: number; unitPrice: number; lineTotal: number }
interface PItem { partId: string; sku: string; name: string; qty: number; unitPrice: number; lineTotal: number }
function compute(ctx: HookCtx, data: Record<string, unknown>) {
  const serviceItems: SItem[] = ((data.services as { serviceId: string; qty?: number }[]) ?? []).map((l) => {
    const s = ctx.get(l.serviceId); if (!s || s.entityType !== 'service') ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown service');
    const qty = l.qty ?? 1; return { serviceId: l.serviceId, name: String(s!.data.name), qty, unitPrice: Number(s!.data.price), lineTotal: Number(s!.data.price) * qty };
  });
  const merged = new Map<string, number>(); for (const l of (data.parts as { partId: string; qty: number }[]) ?? []) merged.set(l.partId, (merged.get(l.partId) ?? 0) + l.qty);
  const partItems: PItem[] = [...merged].map(([id, qty]) => {
    const p = ctx.get(id); if (!p || p.entityType !== 'sparePart') ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown part');
    if (p!.data.active === false) ctx.fail(409, 'NOT_AVAILABLE', `${p!.data.name} is not available`);
    return { partId: id, sku: String(p!.data.sku), name: String(p!.data.name), qty, unitPrice: Number(p!.data.price), lineTotal: Number(p!.data.price) * qty };
  });
  const laborTotal = serviceItems.reduce((a, i) => a + i.lineTotal, 0), partsTotal = partItems.reduce((a, i) => a + i.lineTotal, 0), subtotal = laborTotal + partsTotal;
  const discount = Number(data.discount ?? 0); if (discount > subtotal) ctx.fail(400, 'VALIDATION_ERROR', 'discount cannot exceed the subtotal');
  const tax = applyBasisPoints(subtotal - discount, Number(data.taxBp ?? 0));
  return { ...data, discount, taxBp: Number(data.taxBp ?? 0), serviceItems, partItems, laborTotal, partsTotal, tax, total: subtotal - discount + tax };
}
const WO_NEXT: Record<string, string[]> = { open: ['diagnosing', 'in_progress', 'cancelled'], diagnosing: ['awaiting_parts', 'in_progress', 'cancelled'], awaiting_parts: ['in_progress', 'cancelled'], in_progress: ['ready', 'cancelled'], ready: ['delivered'] };
const LINE_KEYS = ['services', 'parts', 'discount', 'taxBp', 'complaint', 'vehicleId'];
const workOrder: EntityDef = { key: 'workOrder', module: 'workOrders', labelEn: 'Work order', labelAr: 'أمر شغل', titleField: '$code', subtitleField: 'status', autoCode: 'WO-', searchFields: ['complaint'], noDelete: true,
  filterable: ['status', 'vehicleId', 'technicianId'], immutableWhen: { field: 'status', values: ['delivered', 'cancelled'] },
  fields: { vehicleId: { type: 'ref', entity: 'vehicle', required: true }, appointmentId: { type: 'ref', entity: 'appointment' }, technicianId: { type: 'ref', entity: 'technician' }, complaint: { type: 'text', required: true }, notes: { type: 'text' },
    odometerIn: { type: 'int', min: 0 }, odometerOut: { type: 'int', min: 0 },
    services: { type: 'lines', max: 50, fields: { serviceId: { type: 'ref', entity: 'service', required: true }, qty: { type: 'int', min: 1, default: 1 } } },
    parts: { type: 'lines', max: 100, fields: { partId: { type: 'ref', entity: 'sparePart', required: true }, qty: { type: 'int', min: 1, required: true } } },
    discount: { type: 'money', default: 0 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 },
    status: { type: 'enum', values: ['open', 'diagnosing', 'awaiting_parts', 'in_progress', 'ready', 'delivered', 'cancelled'], default: 'open' },
    serviceItems: { type: 'lines', readonly: true, fields: {} }, partItems: { type: 'lines', readonly: true, fields: {} }, laborTotal: { type: 'money', readonly: true }, partsTotal: { type: 'money', readonly: true },
    tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true }, deliveredAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const v = ctx.get(String(data.vehicleId))!;
      return { ...compute(ctx, data), status: 'open', odometerIn: data.odometerIn ?? v.data.odometer ?? 0 };
    }
    const prev = String(existing!.data.status), next = String(data.status);
    const locked = !['open', 'diagnosing', 'awaiting_parts'].includes(prev);
    if (locked && LINE_KEYS.some((k) => JSON.stringify(data[k] ?? null) !== JSON.stringify(existing!.data[k] ?? null))) ctx.fail(409, 'IMMUTABLE', 'Lines are locked once work is in progress');
    if (next !== prev) {
      if (!WO_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change work order from ${prev} to ${next}`);
      if (next === 'delivered') {
        const inv = ctx.find('invoice', { workOrderId: existing!.id })[0];
        if (!inv || inv.data.status !== 'paid') ctx.fail(409, 'UNPAID', 'The invoice must be fully paid before delivery');
      }
    }
    if (data.odometerOut != null && Number(data.odometerOut) < Number(data.odometerIn ?? 0)) ctx.fail(400, 'VALIDATION_ERROR', 'odometerOut cannot be lower than odometerIn');
    const out = locked ? { ...data, serviceItems: existing!.data.serviceItems, partItems: existing!.data.partItems, laborTotal: existing!.data.laborTotal, partsTotal: existing!.data.partsTotal, tax: existing!.data.tax, total: existing!.data.total } : compute(ctx, data);
    return next === 'delivered' && prev !== 'delivered' ? { ...out, deliveredAt: ctx.now.toISOString() } : out;
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create' || record.data.status === previous!.data.status) return;
    const d = record.data; const parts = d.partItems as PItem[];
    if (d.status === 'in_progress') for (const p of parts) ctx.createFull('partMovement', { partId: p.partId, type: 'out', qty: p.qty, reason: `work order ${record.code}`, workOrderId: record.id });
    if (d.status === 'cancelled' && previous!.data.status === 'in_progress') for (const p of parts) ctx.createFull('partMovement', { partId: p.partId, type: 'in', qty: p.qty, reason: `cancelled ${record.code}`, workOrderId: record.id });
    if (d.status === 'ready') ctx.create('invoice', { workOrderId: record.id, total: d.total, paidAmount: 0, status: Number(d.total) === 0 ? 'paid' : 'issued', issuedAt: ctx.now.toISOString() });
    if (d.status === 'delivered' && d.odometerOut != null) ctx.patch(String(d.vehicleId), { odometer: d.odometerOut });
  } };
const invoice: EntityDef = { key: 'invoice', module: 'invoices', labelEn: 'Invoice', labelAr: 'فاتورة', titleField: '$code', subtitleField: 'status', autoCode: 'INV-', noCreate: true, noUpdate: true, noDelete: true, filterable: ['status', 'workOrderId'],
  fields: { workOrderId: { type: 'ref', entity: 'workOrder', readonly: true }, total: { type: 'money', readonly: true }, paidAmount: { type: 'money', readonly: true }, status: { type: 'enum', values: ['issued', 'partially_paid', 'paid'], readonly: true }, issuedAt: { type: 'datetime', readonly: true } } };
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true, filterable: ['invoiceId', 'method'],
  fields: { invoiceId: { type: 'ref', entity: 'invoice', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer'], required: true }, paidAt: { type: 'datetime' } },
  beforeSave: (ctx, { data }) => {
    const inv = ctx.get(String(data.invoiceId))!;
    if (!['issued', 'partially_paid'].includes(String(inv.data.status))) ctx.fail(409, 'INVOICE_NOT_PAYABLE', 'This invoice cannot receive payments');
    if (Number(data.amount) > Number(inv.data.total) - Number(inv.data.paidAmount)) ctx.fail(409, 'OVERPAYMENT', 'Payment exceeds the outstanding balance');
    return { ...data, paidAt: data.paidAt ?? ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => { const inv = ctx.get(String(record.data.invoiceId))!; const paid = Number(inv.data.paidAmount) + Number(record.data.amount); ctx.patch(inv.id, { paidAmount: paid, status: paid >= Number(inv.data.total) ? 'paid' : 'partially_paid' }); } };

export const automotive: ProductDef = {
  slug: 'automotive',
  entities: [customer, vehicle, service, technician, supplier, branch, supportedMake, sparePart, partMovement, purchaseOrder, appointment, bookingRequest, workOrder, warranty, invoice, payment],
  kpis: [
    { key: 'vehicles', labelEn: 'Vehicles', labelAr: 'المركبات', entity: 'vehicle', agg: 'count' },
    { key: 'openWorkOrders', labelEn: 'Open work orders', labelAr: 'أوامر شغل مفتوحة', entity: 'workOrder', agg: 'count', where: { status: ['open', 'diagnosing', 'awaiting_parts', 'in_progress', 'ready'] } },
    { key: 'appointmentsToday', labelEn: 'Appointments today', labelAr: 'مواعيد اليوم', entity: 'appointment', agg: 'count', period: 'today', dateField: 'date' },
    { key: 'revenueMonth', labelEn: 'Revenue this month', labelAr: 'إيراد الشهر', entity: 'payment', agg: 'sum', field: 'amount', period: 'month', dateField: 'paidAt', money: true },
  ],
  reports: [
    { key: 'workOrdersByStatus', labelEn: 'Work orders by status', labelAr: 'أوامر الشغل حسب الحالة', entity: 'workOrder', groupBy: 'status', agg: 'count' },
    { key: 'workOrdersByTechnician', labelEn: 'Work orders by technician', labelAr: 'أوامر الشغل حسب الفني', entity: 'workOrder', groupBy: 'technicianId', agg: 'count' },
    { key: 'revenueByMethod', labelEn: 'Revenue by payment method', labelAr: 'الإيراد حسب طريقة الدفع', entity: 'payment', groupBy: 'method', agg: 'sum', field: 'amount' },
  ],
  publicForms: [{ key: 'booking', entity: 'bookingRequest', fields: ['name', 'phone', 'plate', 'make', 'model', 'serviceId', 'preferredDate', 'preferredTime', 'message'] },
    // a price quote for a service and/or a spare part: same inbox as booking requests, told apart by `kind`
    { key: 'quote', entity: 'bookingRequest', fields: ['name', 'phone', 'plate', 'make', 'model', 'serviceId', 'partId', 'message'], defaults: { kind: 'quote' } }],
  publicActions: [{ key: 'track', method: 'GET', write: false, handler: (ctx, q) => {
    const key = plateKey(String(q.plate ?? '')); const v = ctx.find('vehicle', { plateSearch: key })[0]; const c = v && ctx.get(String(v.data.customerId));
    const phone = latinDigits(String(q.phone ?? '')).replace(/[\s\-().]/g, '');
    if (!v || !c || !c.data.phone || c.data.phone !== phone) ctx.fail(404, 'NOT_FOUND', 'Vehicle not found');
    const w = ctx.find('workOrder', { vehicleId: v!.id }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!w) ctx.fail(404, 'NOT_FOUND', 'No work orders for this vehicle');
    return { plate: v!.data.plate, code: w!.code, status: w!.data.status, readyForPickup: w!.data.status === 'ready', total: w!.data.total };
  } }],
  employeeModules: { carCustomers: ['read', 'create', 'update'], vehicles: ['read', 'create', 'update'], services: ['read'], technicians: ['read'], parts: ['read'], appointments: ['read', 'create', 'update'],
    bookingRequests: ['read', 'update'], workOrders: ['read', 'create', 'update'], invoices: ['read'], payments: ['read', 'create'], branches: ['read'], supportedMakes: ['read'], warranties: ['read', 'create'] },
};
