import { applyBasisPoints } from '@codela/shared';
import type { EntityDef, HookCtx, ProductDef } from '../framework';
import { notifyTenant } from '../../notify';

const today = (ctx: HookCtx) => ctx.now.toISOString().slice(0, 10);
const customer: EntityDef = { key: 'customer', module: 'businessCustomers', labelEn: 'Customer', labelAr: 'عميل', titleField: 'name', subtitleField: '$code', autoCode: 'CU-', searchFields: ['name', 'company', 'phone', 'email', 'taxId'],
  fields: { name: { type: 'string', required: true }, company: { type: 'string' }, phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' }, taxId: { type: 'string', max: 30 } } };
const warehouse: EntityDef = { key: 'warehouse', module: 'warehouses', labelEn: 'Warehouse', labelAr: 'مخزن', titleField: 'name', searchFields: ['name', 'location'], fields: { name: { type: 'string', required: true, unique: true }, location: { type: 'string' } } };
const supplier: EntityDef = { key: 'supplier', module: 'suppliers', labelEn: 'Supplier', labelAr: 'مورد', titleField: 'name', searchFields: ['name', 'phone', 'email', 'taxId'],
  fields: { name: { type: 'string', required: true, unique: true }, phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' }, taxId: { type: 'string', max: 30 } } };
const product: EntityDef = { key: 'product', module: 'products', labelEn: 'Product', labelAr: 'منتج', titleField: 'name', subtitleField: 'sku', searchFields: ['sku', 'name'], filterable: ['supplierId', 'active'],
  fields: { sku: { type: 'string', required: true, unique: true, max: 60 }, name: { type: 'string', required: true }, unit: { type: 'string', max: 20 }, price: { type: 'money', required: true }, cost: { type: 'money' },
    stock: { type: 'int', readonly: true }, reorderLevel: { type: 'int', min: 0 }, supplierId: { type: 'ref', entity: 'supplier' }, active: { type: 'bool', default: true } },
  beforeSave: (_c, { action, data, existing }) => ({ ...data, stock: action === 'create' ? 0 : existing!.data.stock }),
  public: { fields: ['name', 'sku', 'unit', 'price'], filter: { active: true } } };

const PLUS = ['in', 'adjust_up', 'transfer_in', 'return'];
const signed = (t: unknown) => (PLUS.includes(String(t)) ? 1 : -1);
const balance = (ctx: HookCtx, productId: string, warehouseId: string) => ctx.find('stockMovement', { productId, warehouseId }).reduce((a, m) => a + signed(m.data.type) * Number(m.data.qty), 0);
const stockMovement: EntityDef = { key: 'stockMovement', module: 'stock', labelEn: 'Stock movement', labelAr: 'حركة مخزون', titleField: '$code', subtitleField: 'type', autoCode: 'SM-', noUpdate: true, noDelete: true, filterable: ['productId', 'warehouseId', 'type'],
  fields: { productId: { type: 'ref', entity: 'product', required: true }, warehouseId: { type: 'ref', entity: 'warehouse', required: true }, type: { type: 'enum', values: ['in', 'out', 'adjust_up', 'adjust_down', 'return'], required: true },
    qty: { type: 'int', min: 1, required: true }, reason: { type: 'string' }, refType: { type: 'string', readonly: true }, refId: { type: 'string', readonly: true } },
  beforeSave: (ctx, { data }) => { if (signed(data.type) < 0) { const b = balance(ctx, String(data.productId), String(data.warehouseId)); if (Number(data.qty) > b) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${b} available in this warehouse`); } },
  afterSave: (ctx, { record }) => { const p = ctx.get(String(record.data.productId))!; ctx.patch(p.id, { stock: Number(p.data.stock ?? 0) + signed(record.data.type) * Number(record.data.qty) }); } };
const transfer: EntityDef = { key: 'transfer', module: 'transfers', labelEn: 'Warehouse transfer', labelAr: 'تحويل مخزني', titleField: '$code', autoCode: 'TR-', noUpdate: true, noDelete: true, filterable: ['productId'],
  fields: { productId: { type: 'ref', entity: 'product', required: true }, fromWarehouseId: { type: 'ref', entity: 'warehouse', required: true }, toWarehouseId: { type: 'ref', entity: 'warehouse', required: true }, qty: { type: 'int', min: 1, required: true } },
  beforeSave: (ctx, { data }) => {
    if (data.fromWarehouseId === data.toWarehouseId) ctx.fail(400, 'VALIDATION_ERROR', 'Source and destination warehouses must differ');
    const b = balance(ctx, String(data.productId), String(data.fromWarehouseId)); if (Number(data.qty) > b) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${b} available in the source warehouse`);
  },
  afterSave: (ctx, { record }) => { const d = record.data; // net effect on total stock is zero, so only the warehouse ledger changes
    ctx.create('stockMovement', { productId: d.productId, warehouseId: d.fromWarehouseId, type: 'transfer_out', qty: d.qty, reason: `transfer ${record.code}`, refType: 'transfer', refId: record.id });
    ctx.create('stockMovement', { productId: d.productId, warehouseId: d.toWarehouseId, type: 'transfer_in', qty: d.qty, reason: `transfer ${record.code}`, refType: 'transfer', refId: record.id }); } };

const ledgerEntry: EntityDef = { key: 'ledgerEntry', module: 'ledger', labelEn: 'Ledger entry', labelAr: 'قيد', titleField: '$code', subtitleField: 'type', autoCode: 'LG-', noCreate: true, noUpdate: true, noDelete: true, searchFields: ['description'], filterable: ['type', 'date', 'refType'],
  fields: { type: { type: 'enum', values: ['income', 'expense'], readonly: true }, amount: { type: 'money', readonly: true }, date: { type: 'date', readonly: true }, refType: { type: 'string', readonly: true }, refId: { type: 'string', readonly: true }, description: { type: 'string', readonly: true } } };
const book = (ctx: HookCtx, e: { type: 'income' | 'expense'; amount: number; refType: string; refId: string; description: string }) => ctx.create('ledgerEntry', { ...e, date: today(ctx) });

const expense: EntityDef = { key: 'expense', module: 'expenses', labelEn: 'Expense', labelAr: 'مصروف', titleField: '$code', subtitleField: 'category', autoCode: 'EX-', noUpdate: true, noDelete: true, searchFields: ['vendor', 'note'], filterable: ['category', 'date', 'source'],
  fields: { category: { type: 'enum', values: ['rent', 'salaries', 'utilities', 'marketing', 'supplies', 'purchases', 'other'], required: true }, amount: { type: 'money', min: 1, required: true }, date: { type: 'date', required: true }, vendor: { type: 'string' }, note: { type: 'string' },
    source: { type: 'enum', values: ['manual', 'purchase'], readonly: true } },
  beforeSave: (_c, { data }) => ({ ...data, source: 'manual' }),
  afterSave: (ctx, { record }) => book(ctx, { type: 'expense', amount: Number(record.data.amount), refType: 'expense', refId: record.id, description: `${record.data.category}${record.data.vendor ? ' — ' + record.data.vendor : ''}` }) };

const PO_NEXT: Record<string, string[]> = { draft: ['ordered', 'cancelled'], ordered: ['received', 'cancelled'] };
const purchaseOrder: EntityDef = { key: 'purchaseOrder', module: 'purchasing', labelEn: 'Purchase order', labelAr: 'أمر شراء', titleField: '$code', subtitleField: 'status', autoCode: 'PO-', noDelete: true, filterable: ['status', 'supplierId'],
  immutableWhen: { field: 'status', values: ['received', 'cancelled'] },
  fields: { supplierId: { type: 'ref', entity: 'supplier', required: true }, warehouseId: { type: 'ref', entity: 'warehouse', required: true }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 200, fields: { productId: { type: 'ref', entity: 'product', required: true }, qty: { type: 'int', min: 1, required: true }, unitCost: { type: 'money', required: true } } },
    status: { type: 'enum', values: ['draft', 'ordered', 'received', 'cancelled'], default: 'draft' }, total: { type: 'money', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    const total = (data.lines as { qty: number; unitCost: number }[]).reduce((a, l) => a + l.qty * l.unitCost, 0);
    if (action === 'create') return { ...data, status: 'draft', total };
    const prev = String(existing!.data.status), next = String(data.status);
    if (next !== prev && !PO_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change purchase order from ${prev} to ${next}`);
    if (prev !== 'draft' && JSON.stringify(data.lines) !== JSON.stringify(existing!.data.lines)) ctx.fail(409, 'IMMUTABLE', 'Lines are locked once the order is placed');
    return { ...data, total };
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create' || record.data.status !== 'received' || previous!.data.status === 'received') return;
    for (const l of record.data.lines as { productId: string; qty: number }[]) ctx.createFull('stockMovement', { productId: l.productId, warehouseId: record.data.warehouseId, type: 'in', qty: l.qty, reason: `PO ${record.code}` });
    const sup = ctx.get(String(record.data.supplierId))!; const e = ctx.create('expense', { category: 'purchases', amount: record.data.total, date: today(ctx), vendor: sup.data.name, note: `PO ${record.code}`, source: 'purchase' });
    book(ctx, { type: 'expense', amount: Number(record.data.total), refType: 'expense', refId: e.id, description: `purchases — ${sup.data.name}` });
  } };

interface Item { productId: string; sku: string; name: string; qty: number; unitPrice: number; lineTotal: number }
function invoiceTotals(ctx: HookCtx, data: Record<string, unknown>) {
  const items: Item[] = (data.lines as { productId: string; qty: number }[]).map((l) => {
    const p = ctx.get(l.productId)!; if (p.data.active === false) ctx.fail(409, 'NOT_AVAILABLE', `${p.data.name} is not available`);
    return { productId: p.id, sku: String(p.data.sku), name: String(p.data.name), qty: l.qty, unitPrice: Number(p.data.price), lineTotal: Number(p.data.price) * l.qty };
  });
  const subtotal = items.reduce((a, i) => a + i.lineTotal, 0); const discount = Number(data.discount ?? 0); if (discount > subtotal) ctx.fail(400, 'VALIDATION_ERROR', 'discount cannot exceed the subtotal');
  const tax = applyBasisPoints(subtotal - discount, Number(data.taxBp ?? 0));
  return { ...data, discount, taxBp: Number(data.taxBp ?? 0), items, subtotal, tax, total: subtotal - discount + tax };
}
const invoice: EntityDef = { key: 'invoice', module: 'invoices', labelEn: 'Invoice', labelAr: 'فاتورة', titleField: '$code', subtitleField: 'status', autoCode: 'INV-', noDelete: true, filterable: ['status', 'customerId'], immutableWhen: { field: 'status', values: ['paid', 'cancelled'] },
  fields: { customerId: { type: 'ref', entity: 'customer', required: true }, warehouseId: { type: 'ref', entity: 'warehouse', required: true }, dueDate: { type: 'date' }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 200, fields: { productId: { type: 'ref', entity: 'product', required: true }, qty: { type: 'int', min: 1, required: true } } },
    discount: { type: 'money', default: 0 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 }, status: { type: 'enum', values: ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'], default: 'draft' },
    items: { type: 'lines', readonly: true, fields: {} }, subtotal: { type: 'money', readonly: true }, tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true }, paidAmount: { type: 'money', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') return { ...invoiceTotals(ctx, data), status: 'draft', paidAmount: 0 };
    const prev = String(existing!.data.status), next = String(data.status);
    if (prev !== 'draft') {
      const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(existing!.data[k]));
      if (changed.some((k) => k !== 'status') || (next !== prev && !(next === 'cancelled' && Number(existing!.data.paidAmount) === 0))) ctx.fail(409, 'IMMUTABLE', 'Issued invoices can only be cancelled (when unpaid)');
      return data;
    }
    if (!['draft', 'issued', 'cancelled'].includes(next)) ctx.fail(409, 'INVALID_TRANSITION', 'A draft invoice can only be issued or cancelled');
    return invoiceTotals(ctx, data);
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create' || record.data.status === previous!.data.status) return;
    const items = record.data.items as Item[];
    if (record.data.status === 'issued') for (const i of items) ctx.createFull('stockMovement', { productId: i.productId, warehouseId: record.data.warehouseId, type: 'out', qty: i.qty, reason: `invoice ${record.code}` });
    if (record.data.status === 'cancelled' && previous!.data.status === 'issued') for (const i of items) ctx.createFull('stockMovement', { productId: i.productId, warehouseId: record.data.warehouseId, type: 'return', qty: i.qty, reason: `cancelled ${record.code}` });
  } };
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true, filterable: ['invoiceId', 'method'],
  fields: { invoiceId: { type: 'ref', entity: 'invoice', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer', 'cheque'], required: true }, paidAt: { type: 'datetime' } },
  beforeSave: (ctx, { data }) => {
    const inv = ctx.get(String(data.invoiceId))!;
    if (!['issued', 'partially_paid'].includes(String(inv.data.status))) ctx.fail(409, 'INVOICE_NOT_PAYABLE', 'Payments can only be recorded on issued invoices');
    if (Number(data.amount) > Number(inv.data.total) - Number(inv.data.paidAmount)) ctx.fail(409, 'OVERPAYMENT', 'Payment exceeds the outstanding balance');
    return { ...data, paidAt: data.paidAt ?? ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => {
    const inv = ctx.get(String(record.data.invoiceId))!; const paid = Number(inv.data.paidAmount) + Number(record.data.amount);
    ctx.patch(inv.id, { paidAmount: paid, status: paid >= Number(inv.data.total) ? 'paid' : 'partially_paid' });
    book(ctx, { type: 'income', amount: Number(record.data.amount), refType: 'payment', refId: record.id, description: `invoice ${inv.code}` });
  } };

const lead: EntityDef = { key: 'lead', module: 'leads', labelEn: 'Lead', labelAr: 'عميل محتمل', titleField: 'name', subtitleField: '$code', autoCode: 'LD-', searchFields: ['name', 'company', 'phone', 'email'], filterable: ['stage', 'source'],
  immutableWhen: { field: 'stage', values: ['won', 'lost'] },
  fields: { name: { type: 'string', required: true }, company: { type: 'string' }, phone: { type: 'phone' }, email: { type: 'email' }, source: { type: 'enum', values: ['website', 'referral', 'call', 'event', 'other'], default: 'other' },
    stage: { type: 'enum', values: ['new', 'contacted', 'qualified', 'won', 'lost'], default: 'new' }, value: { type: 'money' }, notes: { type: 'text' }, convertedCustomerId: { type: 'ref', entity: 'customer', readonly: true } },
  afterSave: (ctx, { action, record, previous }) => {
    if (record.data.stage !== 'won' || (action === 'update' && previous!.data.stage === 'won')) return;
    const d = record.data;
    const byPhone = d.phone ? ctx.find('customer', { phone: d.phone })[0] : undefined;
    const byEmail = !byPhone && d.email ? ctx.find('customer', { email: d.email })[0] : undefined;
    const c = byPhone ?? byEmail ?? ctx.createFull('customer', { name: d.name, company: d.company, phone: d.phone, email: d.email });
    ctx.patch(record.id, { convertedCustomerId: c.id });
  } };
const PROB: Record<string, number> = { prospecting: 1000, qualified: 2500, proposal: 5000, negotiation: 7500, won: 10000, lost: 0 };
const deal: EntityDef = { key: 'deal', module: 'deals', labelEn: 'Deal', labelAr: 'صفقة', titleField: 'title', subtitleField: '$code', autoCode: 'DL-', searchFields: ['title'], filterable: ['stage', 'customerId'], immutableWhen: { field: 'stage', values: ['won', 'lost'] },
  fields: { customerId: { type: 'ref', entity: 'customer', required: true }, title: { type: 'string', required: true }, value: { type: 'money', required: true }, expectedClose: { type: 'date' },
    stage: { type: 'enum', values: ['prospecting', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], default: 'prospecting' }, probabilityBp: { type: 'int', readonly: true }, weightedValue: { type: 'money', readonly: true } },
  beforeSave: (_c, { data }) => { const p = PROB[String(data.stage ?? 'prospecting')]; return { ...data, stage: data.stage ?? 'prospecting', probabilityBp: p, weightedValue: applyBasisPoints(Number(data.value), p) }; } };
const employee: EntityDef = { key: 'employee', module: 'hr', labelEn: 'Employee', labelAr: 'موظف', titleField: 'name', subtitleField: '$code', autoCode: 'EM-', sensitive: true, searchFields: ['name', 'phone', 'email', 'position', 'department'], filterable: ['department', 'status'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, position: { type: 'string' }, department: { type: 'string' }, salary: { type: 'money', sensitive: true }, hireDate: { type: 'date' }, status: { type: 'enum', values: ['active', 'inactive'], default: 'active' } } };
const task: EntityDef = { key: 'task', module: 'tasks', labelEn: 'Task', labelAr: 'مهمة', titleField: 'title', subtitleField: '$code', autoCode: 'TK-', searchFields: ['title'], filterable: ['status', 'assigneeId', 'priority'],
  fields: { title: { type: 'string', required: true }, description: { type: 'text' }, assigneeId: { type: 'ref', entity: 'employee' }, status: { type: 'enum', values: ['todo', 'doing', 'done'], default: 'todo' }, priority: { type: 'enum', values: ['low', 'normal', 'high'], default: 'normal' }, dueDate: { type: 'date' } } };
const inquiry: EntityDef = { key: 'inquiry', module: 'inquiries', labelEn: 'Inquiry', labelAr: 'استفسار', titleField: 'name', searchFields: ['name', 'phone', 'message'], filterable: ['status', 'kind'],
  fields: { kind: { type: 'enum', values: ['inquiry', 'quote'], default: 'inquiry' }, name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' }, message: { type: 'text', required: true }, status: { type: 'enum', values: ['new', 'handled'], default: 'new' } } };

const simple = (key: string, module: string, en: string, ar: string, fields: EntityDef['fields'], extra: Partial<EntityDef> = {}): EntityDef =>
  ({ key, module, labelEn: en, labelAr: ar, titleField: Object.keys(fields)[0], fields, ...extra });

const MIN = (t: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** One row per employee and day. Hours are computed on the server from check-in / check-out (HH:MM, business-local time). */
const attendance: EntityDef = { key: 'attendance', module: 'attendance', labelEn: 'Attendance', labelAr: 'حضور وانصراف', titleField: '$code', subtitleField: 'date', autoCode: 'AT-', sensitive: true, filterable: ['employeeId', 'date', 'status'],
  fields: { employeeId: { type: 'ref', entity: 'employee', required: true }, date: { type: 'date', required: true }, checkIn: { type: 'time' }, checkOut: { type: 'time' }, status: { type: 'enum', values: ['present', 'late', 'absent', 'leave'], default: 'present' }, notes: { type: 'text' }, minutes: { type: 'int', readonly: true } },
  beforeSave: (ctx, { data, existing }) => {
    const a = MIN(data.checkIn), b = MIN(data.checkOut);
    if (data.checkOut && !data.checkIn) ctx.fail(400, 'VALIDATION_ERROR', 'A check-out needs a check-in'); if (a !== null && b !== null && b <= a) ctx.fail(400, 'VALIDATION_ERROR', 'Check-out must be after check-in');
    if (['absent', 'leave'].includes(String(data.status)) && (data.checkIn || data.checkOut)) ctx.fail(400, 'VALIDATION_ERROR', 'An absent / leave day has no check-in or check-out');
    if (ctx.find('attendance', { employeeId: data.employeeId, date: data.date }).some((r) => r.id !== existing?.id)) ctx.fail(409, 'DUPLICATE', 'This employee already has an attendance record for that day');
    return { ...data, minutes: a !== null && b !== null ? b - a : 0 };
  } };

const QT_NEXT: Record<string, string[]> = { draft: ['sent', 'rejected'], sent: ['accepted', 'rejected', 'expired'] };
/** Sales quotation: server-computed totals; accepting it wins the linked deal. Once sent, the content is frozen. */
const quotation: EntityDef = { key: 'quotation', module: 'quotations', labelEn: 'Quotation', labelAr: 'عرض سعر', titleField: '$code', subtitleField: 'status', autoCode: 'QT-', noDelete: true, searchFields: ['title'], filterable: ['status', 'customerId', 'dealId'],
  immutableWhen: { field: 'status', values: ['accepted', 'rejected', 'expired'] },
  fields: { customerId: { type: 'ref', entity: 'customer', required: true }, dealId: { type: 'ref', entity: 'deal' }, title: { type: 'string', required: true, max: 200 }, validUntil: { type: 'date' }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 200, fields: { description: { type: 'string', required: true, max: 300 }, qty: { type: 'int', min: 1, required: true }, unitPrice: { type: 'money', min: 0, required: true } } },
    discount: { type: 'money', default: 0, min: 0 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 }, status: { type: 'enum', values: ['draft', 'sent', 'accepted', 'rejected', 'expired'], default: 'draft' },
    subtotal: { type: 'money', readonly: true }, tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create' && data.status && data.status !== 'draft') ctx.fail(409, 'INVALID_TRANSITION', 'A new quotation starts as a draft');
    if (data.dealId && ctx.get(String(data.dealId))!.data.customerId !== data.customerId) ctx.fail(400, 'VALIDATION_ERROR', 'The deal belongs to another customer');
    const prev = existing ? String(existing.data.status) : 'draft', next = String(data.status ?? 'draft');
    if (existing && next !== prev && !QT_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change quotation from ${prev} to ${next}`);
    if (existing && prev !== 'draft' && JSON.stringify(data.lines) !== JSON.stringify(existing.data.lines)) ctx.fail(409, 'LOCKED', 'A sent quotation cannot be edited');
    const lines = (data.lines as { qty: number; unitPrice: number }[]); const subtotal = lines.reduce((n, l) => n + Number(l.qty) * Number(l.unitPrice), 0); const discount = Number(data.discount ?? 0);
    if (discount > subtotal) ctx.fail(400, 'VALIDATION_ERROR', 'The discount cannot exceed the subtotal');
    const tax = applyBasisPoints(subtotal - discount, Number(data.taxBp ?? 0));
    return { ...data, status: next, subtotal, tax, total: subtotal - discount + tax };
  },
  afterSave: (ctx, { record, previous }) => {
    if (record.data.status !== 'accepted' || previous?.data.status === 'accepted' || !record.data.dealId) return;
    const deal = ctx.get(String(record.data.dealId)); if (deal && !['won', 'lost'].includes(String(deal.data.stage))) ctx.patch(deal.id, { stage: 'won', probabilityBp: 10000, weightedValue: Number(deal.data.value) });
    notifyTenant(ctx.db, ctx.tenantId, 'quotation', `Quotation ${record.code} accepted`, String(record.data.title));
  } };

// ---- public website content (shown only when active) ----
const companyService = simple('service', 'services', 'Service', 'خدمة', { name: { type: 'string', required: true }, description: { type: 'text' }, position: { type: 'int', default: 0 }, active: { type: 'bool', default: true } },
  { searchFields: ['name'], filterable: ['active'], public: { fields: ['name', 'description', 'position'], filter: { active: true } } });
const teamMember = simple('teamMember', 'team', 'Team member', 'عضو فريق', { name: { type: 'string', required: true }, title: { type: 'string' }, bio: { type: 'text' }, photoUrl: { type: 'url' }, position: { type: 'int', default: 0 }, active: { type: 'bool', default: true } },
  { searchFields: ['name', 'title'], filterable: ['active'], public: { fields: ['name', 'title', 'bio', 'photoUrl', 'position'], filter: { active: true } } });
const industry = simple('industry', 'industries', 'Industry served', 'قطاع نخدمه', { name: { type: 'string', required: true }, description: { type: 'text' }, position: { type: 'int', default: 0 }, active: { type: 'bool', default: true } },
  { searchFields: ['name'], filterable: ['active'], public: { fields: ['name', 'description', 'position'], filter: { active: true } } });
const portfolioItem = simple('portfolioItem', 'portfolio', 'Portfolio item', 'عمل سابق', { title: { type: 'string', required: true }, client: { type: 'string' }, description: { type: 'text' }, imageUrl: { type: 'url' }, year: { type: 'int', min: 1990, max: 2100 }, active: { type: 'bool', default: true } },
  { searchFields: ['title', 'client'], filterable: ['active', 'year'], public: { fields: ['title', 'client', 'description', 'imageUrl', 'year'], filter: { active: true } } });
const job = simple('job', 'careers', 'Job opening', 'وظيفة شاغرة', { title: { type: 'string', required: true }, department: { type: 'string' }, location: { type: 'string' }, type: { type: 'enum', values: ['full_time', 'part_time', 'contract', 'internship'], default: 'full_time' }, description: { type: 'text' }, requirements: { type: 'text' }, active: { type: 'bool', default: true } },
  { searchFields: ['title', 'department'], filterable: ['active', 'type'], public: { fields: ['title', 'department', 'location', 'type', 'description', 'requirements'], filter: { active: true } } });
const jobApplication: EntityDef = { key: 'jobApplication', module: 'jobApplications', labelEn: 'Job application', labelAr: 'طلب توظيف', titleField: 'name', subtitleField: 'status', autoCode: 'JA-', sensitive: true, searchFields: ['name', 'phone', 'email'], filterable: ['status', 'jobId'],
  fields: { jobId: { type: 'ref', entity: 'job', required: true }, name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email', required: true }, message: { type: 'text' }, cvUrl: { type: 'url' }, status: { type: 'enum', values: ['new', 'reviewed', 'shortlisted', 'rejected'], default: 'new' } },
  beforeSave: (ctx, { action, data }) => { if (action === 'create' && ctx.get(String(data.jobId))!.data.active === false) ctx.fail(409, 'JOB_CLOSED', 'This position is closed'); } };

export const business: ProductDef = {
  slug: 'business',
  entities: [customer, warehouse, supplier, product, stockMovement, transfer, ledgerEntry, expense, purchaseOrder, invoice, payment, lead, deal, employee, task, inquiry, quotation, attendance, companyService, teamMember, industry, portfolioItem, job, jobApplication],
  kpis: [
    { key: 'customers', labelEn: 'Customers', labelAr: 'العملاء', entity: 'customer', agg: 'count' },
    { key: 'openDeals', labelEn: 'Open deals', labelAr: 'صفقات مفتوحة', entity: 'deal', agg: 'count', where: { stage: ['prospecting', 'qualified', 'proposal', 'negotiation'] } },
    { key: 'pipelineWeighted', labelEn: 'Weighted pipeline', labelAr: 'قيمة خط المبيعات المرجّحة', entity: 'deal', agg: 'sum', field: 'weightedValue', where: { stage: ['prospecting', 'qualified', 'proposal', 'negotiation'] }, money: true },
    { key: 'incomeMonth', labelEn: 'Income this month', labelAr: 'إيرادات الشهر', entity: 'ledgerEntry', agg: 'sum', field: 'amount', where: { type: 'income' }, period: 'month', dateField: 'date', money: true },
    { key: 'expenseMonth', labelEn: 'Expenses this month', labelAr: 'مصروفات الشهر', entity: 'ledgerEntry', agg: 'sum', field: 'amount', where: { type: 'expense' }, period: 'month', dateField: 'date', money: true },
    { key: 'quotationsOpen', labelEn: 'Open quotations', labelAr: 'عروض أسعار مفتوحة', entity: 'quotation', agg: 'count', where: { status: ['draft', 'sent'] } },
    { key: 'outstanding', labelEn: 'Outstanding invoices', labelAr: 'فواتير مستحقة', entity: 'invoice', agg: 'sum', field: 'total', minusField: 'paidAmount', where: { status: ['issued', 'partially_paid'] }, money: true },
  ],
  reports: [
    { key: 'quotationsByStatus', labelEn: 'Quotations by status', labelAr: 'عروض الأسعار حسب الحالة', entity: 'quotation', groupBy: 'status', agg: 'count' },
    { key: 'attendanceByStatus', labelEn: 'Attendance by status', labelAr: 'الحضور حسب الحالة', entity: 'attendance', groupBy: 'status', agg: 'count' },
    { key: 'hoursByEmployee', labelEn: 'Minutes worked by employee', labelAr: 'دقائق العمل لكل موظف', entity: 'attendance', groupBy: 'employeeId', agg: 'sum', field: 'minutes' },
    { key: 'leadsByStage', labelEn: 'Leads by stage', labelAr: 'العملاء المحتملون حسب المرحلة', entity: 'lead', groupBy: 'stage', agg: 'count' },
    { key: 'dealsByStage', labelEn: 'Deals by stage', labelAr: 'الصفقات حسب المرحلة', entity: 'deal', groupBy: 'stage', agg: 'count' },
    { key: 'salesByCustomer', labelEn: 'Collected sales by customer', labelAr: 'المبيعات المحصّلة حسب العميل', entity: 'invoice', groupBy: 'customerId', agg: 'sum', field: 'paidAmount' },
    { key: 'cashflowByType', labelEn: 'Cash flow', labelAr: 'التدفق النقدي', entity: 'ledgerEntry', groupBy: 'type', agg: 'sum', field: 'amount' },
    { key: 'expensesByCategory', labelEn: 'Expenses by category', labelAr: 'المصروفات حسب البند', entity: 'expense', groupBy: 'category', agg: 'sum', field: 'amount' },
  ],
  publicForms: [{ key: 'inquiry', entity: 'inquiry', fields: ['name', 'phone', 'email', 'message'] },
    // quotation requests share the inquiry inbox (kind forced server-side); applications go to HR
    { key: 'quoteRequest', entity: 'inquiry', fields: ['name', 'phone', 'email', 'message'], defaults: { kind: 'quote' } },
    { key: 'jobApplication', entity: 'jobApplication', fields: ['jobId', 'name', 'phone', 'email', 'message', 'cvUrl'] }],
  employeeModules: { businessCustomers: ['read', 'create', 'update'], leads: ['read', 'create', 'update'], deals: ['read', 'create', 'update'], products: ['read'], stock: ['read'], invoices: ['read', 'create', 'update'], payments: ['read', 'create'],
    tasks: ['read', 'create', 'update'], inquiries: ['read', 'update'], warehouses: ['read'],
    quotations: ['read', 'create', 'update'] },
  // job roles: each sees (and can change) only what the job needs - enforced by the API, not just hidden in the menu
  roles: {
    sales: { labelEn: 'Sales', labelAr: 'مبيعات', modules: { businessCustomers: ['read', 'create', 'update'], leads: ['read', 'create', 'update'], deals: ['read', 'create', 'update'], quotations: ['read', 'create', 'update'], products: ['read'], invoices: ['read'], tasks: ['read', 'create', 'update'], inquiries: ['read', 'update'] } },
    warehouse: { labelEn: 'Warehouse', labelAr: 'مخازن', modules: { products: ['read', 'create', 'update'], stock: ['read', 'create'], warehouses: ['read'], transfers: ['read', 'create'], purchasing: ['read', 'create', 'update'], suppliers: ['read'], tasks: ['read', 'update'] } },
    accountant: { labelEn: 'Accountant', labelAr: 'محاسب', modules: { invoices: ['read', 'create', 'update', 'export'], payments: ['read', 'create', 'update', 'approve', 'export'], expenses: ['read', 'create', 'update', 'export'], ledger: ['read'], businessCustomers: ['read'], purchasing: ['read'], suppliers: ['read'], quotations: ['read'] } },
    hr: { labelEn: 'HR', labelAr: 'موارد بشرية', modules: { hr: ['read', 'create', 'update'], attendance: ['read', 'create', 'update'], jobApplications: ['read', 'update'], tasks: ['read'] } },
  },
};
