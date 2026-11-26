import { applyBasisPoints } from '@codela/shared';
import type { EntityDef, HookCtx, ProductDef } from '../framework';

const CATS = ['labor', 'material', 'subcontract', 'equipment', 'other'] as const;
const simple = (key: string, module: string, en: string, ar: string, fields: EntityDef['fields'], extra: Partial<EntityDef> = {}): EntityDef =>
  ({ key, module, labelEn: en, labelAr: ar, titleField: 'name', searchFields: ['name', 'phone'], fields, ...extra });
const client = simple('client', 'clients', 'Client', 'عميل', { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, company: { type: 'string' }, address: { type: 'string' } }, { subtitleField: '$code', autoCode: 'CL-', searchFields: ['name', 'phone', 'email', 'company'] });
const supplier = simple('supplier', 'suppliers', 'Supplier', 'مورد', { name: { type: 'string', required: true, unique: true }, phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' } });
const worker = simple('worker', 'workers', 'Worker', 'عامل', { name: { type: 'string', required: true }, phone: { type: 'phone' }, trade: { type: 'string' }, dailyRate: { type: 'money', required: true }, active: { type: 'bool', default: true } }, { searchFields: ['name', 'phone', 'trade'], filterable: ['active', 'trade'] });

const PLUS = ['in', 'return', 'adjust_up'];
const material: EntityDef = { key: 'material', module: 'materials', labelEn: 'Material', labelAr: 'خامة', titleField: 'name', subtitleField: 'sku', searchFields: ['sku', 'name'], filterable: ['supplierId', 'unit'],
  fields: { sku: { type: 'string', required: true, unique: true, max: 60 }, name: { type: 'string', required: true }, unit: { type: 'enum', values: ['pcs', 'm', 'm2', 'm3', 'kg', 'ton', 'l', 'bag'], required: true }, cost: { type: 'money', required: true },
    stock: { type: 'int', readonly: true }, reorderLevel: { type: 'int', min: 0 }, supplierId: { type: 'ref', entity: 'supplier' } },
  beforeSave: (_c, { action, data, existing }) => ({ ...data, stock: action === 'create' ? 0 : existing!.data.stock }) };

/** Recomputes the server-owned project figures from the ledgers. */
function recompute(ctx: HookCtx, projectId: string) {
  const p = ctx.get(projectId); if (!p) return;
  const actual = ctx.find('expense', { projectId }).reduce((a, e) => a + Number(e.data.amount), 0);
  const budget = ctx.find('budgetLine', { projectId }).reduce((a, b) => a + Number(b.data.amount), 0);
  const tasks = ctx.find('task', { projectId }).filter((t) => t.data.status !== 'cancelled'); const done = tasks.filter((t) => t.data.status === 'done').length;
  ctx.patch(projectId, { actualCost: actual, budget, progressPct: tasks.length ? Math.floor((done * 100) / tasks.length) : 0, overBudget: budget > 0 && actual > budget });
}
function bookExpense(ctx: HookCtx, e: { projectId: string; category: string; amount: number; date: string; description: string; source: string }) {
  const p = ctx.get(e.projectId)!; if (['completed', 'cancelled'].includes(String(p.data.status))) ctx.fail(409, 'PROJECT_CLOSED', 'The project is closed');
  if (e.amount === 0) return; ctx.create('expense', e); recompute(ctx, e.projectId);
}
const day = (ctx: HookCtx) => ctx.now.toISOString().slice(0, 10);

const warehouse: EntityDef = { key: 'warehouse', module: 'warehouses', labelEn: 'Warehouse', labelAr: 'مخزن', titleField: 'name', subtitleField: 'location', searchFields: ['name', 'location'], filterable: ['active'],
  fields: { name: { type: 'string', required: true, unique: true }, location: { type: 'string' }, keeper: { type: 'string' }, active: { type: 'bool', default: true } } };
const warehouseBalance = (ctx: HookCtx, materialId: string, warehouseId: string) => ctx.find('warehouseStockLedger', { materialId, warehouseId }).reduce((a, r) => a + Number(r.data.delta ?? 0), 0);
/** Per-warehouse material ledger: system-written (movements and transfers); a warehouse balance is the sum of its rows. */
const warehouseStockLedger: EntityDef = { key: 'warehouseStockLedger', module: 'materialStock', labelEn: 'Warehouse stock ledger', labelAr: 'دفتر مخزون المخزن', titleField: '$code', subtitleField: 'kind', autoCode: 'WSL-', noCreate: true, noUpdate: true, noDelete: true, filterable: ['materialId', 'warehouseId', 'kind'],
  fields: { materialId: { type: 'ref', entity: 'material', readonly: true }, warehouseId: { type: 'ref', entity: 'warehouse', readonly: true }, delta: { type: 'int', readonly: true }, kind: { type: 'string', readonly: true }, movementId: { type: 'string', readonly: true }, transferId: { type: 'string', readonly: true }, at: { type: 'datetime', readonly: true } } };
/** Moves material between two warehouses atomically: both ledger rows are written together; total stock is unchanged. */
const materialTransfer: EntityDef = { key: 'materialTransfer', module: 'materialStock', labelEn: 'Warehouse transfer', labelAr: 'تحويل بين المخازن', titleField: '$code', autoCode: 'WTR-', noUpdate: true, noDelete: true, filterable: ['materialId', 'fromWarehouseId', 'toWarehouseId'],
  fields: { materialId: { type: 'ref', entity: 'material', required: true }, fromWarehouseId: { type: 'ref', entity: 'warehouse', required: true }, toWarehouseId: { type: 'ref', entity: 'warehouse', required: true }, qty: { type: 'int', min: 1, required: true }, note: { type: 'string', max: 200 } },
  beforeSave: (ctx, { data }) => {
    if (data.fromWarehouseId === data.toWarehouseId) ctx.fail(400, 'VALIDATION_ERROR', 'The source and target warehouses must differ');
    const b = warehouseBalance(ctx, String(data.materialId), String(data.fromWarehouseId)); if (Number(data.qty) > b) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${b} in stock in the source warehouse`);
  },
  afterSave: (ctx, { record }) => {
    const d = record.data, at = ctx.now.toISOString();
    ctx.create('warehouseStockLedger', { materialId: d.materialId, warehouseId: d.fromWarehouseId, delta: -Number(d.qty), kind: 'transfer_out', transferId: record.id, at });
    ctx.create('warehouseStockLedger', { materialId: d.materialId, warehouseId: d.toWarehouseId, delta: Number(d.qty), kind: 'transfer_in', transferId: record.id, at });
  } };
/** Bill of quantities / estimate: material and labour cost lines with a markup. Finalising it creates the draft quotation for the client (selling price = cost + markup). */
const boqEstimate: EntityDef = { key: 'boqEstimate', module: 'estimates', labelEn: 'Estimate (BOQ)', labelAr: 'مقايسة', titleField: 'title', subtitleField: '$code', autoCode: 'BOQ-', searchFields: ['title'], filterable: ['status', 'clientId', 'projectId'], noDelete: true,
  immutableWhen: { field: 'status', values: ['final'] },
  fields: { clientId: { type: 'ref', entity: 'client', required: true }, projectId: { type: 'ref', entity: 'project' }, title: { type: 'string', required: true, max: 160 }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 300, fields: { kind: { type: 'enum', values: ['material', 'labour', 'other'], required: true }, desc: { type: 'string', required: true }, unit: { type: 'string', max: 20 }, qty: { type: 'int', min: 1, required: true }, unitCost: { type: 'money', required: true } } },
    markupBp: { type: 'int', min: 0, max: 100000, default: 0 }, status: { type: 'enum', values: ['draft', 'final'], default: 'draft' },
    materialCost: { type: 'money', readonly: true }, labourCost: { type: 'money', readonly: true }, otherCost: { type: 'money', readonly: true }, totalCost: { type: 'money', readonly: true }, sellingPrice: { type: 'money', readonly: true }, quotationId: { type: 'ref', entity: 'quotation', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'update' && existing!.data.status === 'final') ctx.fail(409, 'IMMUTABLE', 'A final estimate cannot be changed');
    const lines = (data.lines as { kind: string; qty: number; unitCost: number }[]) ?? [];
    const sum = (k: string) => lines.filter((l) => l.kind === k).reduce((a, l) => a + l.qty * l.unitCost, 0);
    const materialCost = sum('material'), labourCost = sum('labour'), otherCost = sum('other'); const totalCost = materialCost + labourCost + otherCost;
    return { ...data, materialCost, labourCost, otherCost, totalCost, sellingPrice: totalCost + applyBasisPoints(totalCost, Number(data.markupBp ?? 0)) };
  },
  afterSave: (ctx, { record, previous }) => {
    if (record.data.status !== 'final' || previous?.data.status === 'final') return;
    const mk = Number(record.data.markupBp ?? 0);
    const q = ctx.createFull('quotation', { clientId: record.data.clientId, title: String(record.data.title), notes: `From estimate ${record.code ?? ''}`.trim(),
      lines: (record.data.lines as { desc: string; unit?: string; qty: number; unitCost: number }[]).map((l) => ({ desc: l.desc, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), unitPrice: l.unitCost + applyBasisPoints(l.unitCost, mk) })) });
    ctx.patch(record.id, { quotationId: q.id });
  } };
const materialMovement: EntityDef = { key: 'materialMovement', module: 'materialStock', labelEn: 'Material movement', labelAr: 'حركة خامات', titleField: '$code', subtitleField: 'type', autoCode: 'MM-', noUpdate: true, noDelete: true, filterable: ['materialId', 'projectId', 'type', 'warehouseId'],
  fields: { warehouseId: { type: 'ref', entity: 'warehouse' }, materialId: { type: 'ref', entity: 'material', required: true }, type: { type: 'enum', values: ['in', 'out', 'return', 'waste', 'adjust_up', 'adjust_down'], required: true }, qty: { type: 'int', min: 1, required: true }, projectId: { type: 'ref', entity: 'project' }, reason: { type: 'string' } },
  beforeSave: (ctx, { data }) => {
    if (data.type === 'out' && !data.projectId) ctx.fail(400, 'VALIDATION_ERROR', 'projectId is required when issuing material');
    const cur = Number(ctx.get(String(data.materialId))!.data.stock ?? 0);
    if (!PLUS.includes(String(data.type)) && Number(data.qty) > cur) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${cur} in stock`);
    // a warehouse movement can only draw on that warehouse's own balance
    if (data.warehouseId && !PLUS.includes(String(data.type))) { const b = warehouseBalance(ctx, String(data.materialId), String(data.warehouseId)); if (Number(data.qty) > b) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${b} in stock in this warehouse`); }
  },
  afterSave: (ctx, { record }) => {
    const m = ctx.get(String(record.data.materialId))!; const t = String(record.data.type); const qty = Number(record.data.qty);
    ctx.patch(m.id, { stock: Number(m.data.stock ?? 0) + (PLUS.includes(t) ? qty : -qty) });
    if (record.data.warehouseId) ctx.create('warehouseStockLedger', { materialId: m.id, warehouseId: record.data.warehouseId, delta: (PLUS.includes(t) ? 1 : -1) * qty, kind: 'movement', movementId: record.id, at: ctx.now.toISOString() });
    const pid = record.data.projectId as string | undefined;
    if (pid && (t === 'out' || t === 'return')) bookExpense(ctx, { projectId: pid, category: 'material', amount: (t === 'out' ? 1 : -1) * qty * Number(m.data.cost), date: day(ctx), description: `${t === 'out' ? 'Issued' : 'Returned'} ${qty} x ${m.data.name}`, source: 'material' });
  } };

const project: EntityDef = { key: 'project', module: 'projects', labelEn: 'Project', labelAr: 'مشروع', titleField: 'name', subtitleField: '$code', autoCode: 'PJ-', searchFields: ['name', 'location'], filterable: ['status', 'clientId', 'overBudget', 'showInPortfolio'],
  fields: { name: { type: 'string', required: true }, clientId: { type: 'ref', entity: 'client', required: true }, location: { type: 'string' }, description: { type: 'text' }, startDate: { type: 'date' }, endDate: { type: 'date' },
    status: { type: 'enum', values: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], default: 'planning' }, showInPortfolio: { type: 'bool', default: false },
    images: { type: 'lines', max: 30, fields: { url: { type: 'url', required: true }, caption: { type: 'string' }, kind: { type: 'string', max: 10 } } }, // kind: gallery | before | after
    actualCost: { type: 'money', readonly: true }, budget: { type: 'money', readonly: true }, contractValue: { type: 'money', readonly: true }, progressPct: { type: 'int', readonly: true }, overBudget: { type: 'bool', readonly: true } },
  beforeSave: (ctx, { action, data }) => {
    if (data.startDate && data.endDate && String(data.endDate) < String(data.startDate)) ctx.fail(400, 'VALIDATION_ERROR', 'endDate cannot be before startDate');
    return action === 'create' ? { ...data, actualCost: 0, budget: 0, progressPct: 0, overBudget: false } : data;
  },
  public: { fields: ['name', 'location', 'description', 'images', 'startDate', 'endDate'], filter: { status: 'completed', showInPortfolio: true } } };
const milestone: EntityDef = { key: 'milestone', module: 'milestones', labelEn: 'Milestone', labelAr: 'مرحلة', titleField: 'title', searchFields: ['title'], filterable: ['projectId', 'status'],
  fields: { projectId: { type: 'ref', entity: 'project', required: true }, title: { type: 'string', required: true }, dueDate: { type: 'date' }, status: { type: 'enum', values: ['pending', 'in_progress', 'done'], default: 'pending' }, amount: { type: 'money' } } };
const task: EntityDef = { key: 'task', module: 'tasks', labelEn: 'Task', labelAr: 'مهمة', titleField: 'title', searchFields: ['title'], filterable: ['projectId', 'milestoneId', 'assigneeId', 'status'], noDelete: true,
  fields: { projectId: { type: 'ref', entity: 'project', required: true }, milestoneId: { type: 'ref', entity: 'milestone' }, assigneeId: { type: 'ref', entity: 'worker' }, title: { type: 'string', required: true }, dueDate: { type: 'date' },
    priority: { type: 'enum', values: ['low', 'normal', 'high'], default: 'normal' }, status: { type: 'enum', values: ['todo', 'doing', 'done', 'cancelled'], default: 'todo' } },
  afterSave: (ctx, { record }) => recompute(ctx, String(record.data.projectId)) };
const budgetLine: EntityDef = { key: 'budgetLine', module: 'budgets', labelEn: 'Budget line', labelAr: 'بند ميزانية', titleField: 'category', filterable: ['projectId', 'category'], noDelete: true,
  fields: { projectId: { type: 'ref', entity: 'project', required: true }, category: { type: 'enum', values: CATS, required: true }, amount: { type: 'money', required: true }, note: { type: 'string' } },
  afterSave: (ctx, { record }) => recompute(ctx, String(record.data.projectId)) };
const expense: EntityDef = { key: 'expense', module: 'expenses', labelEn: 'Expense', labelAr: 'مصروف', titleField: '$code', subtitleField: 'category', autoCode: 'EX-', noUpdate: true, noDelete: true, searchFields: ['description'], filterable: ['projectId', 'category', 'source', 'date'],
  fields: { projectId: { type: 'ref', entity: 'project', required: true }, category: { type: 'enum', values: CATS, required: true }, amount: { type: 'money', min: 1, required: true }, date: { type: 'date', required: true }, description: { type: 'string' },
    supplierId: { type: 'ref', entity: 'supplier' }, source: { type: 'enum', values: ['manual', 'material', 'purchase', 'labor'], readonly: true } },
  beforeSave: (ctx, { data }) => {
    if (['completed', 'cancelled'].includes(String(ctx.get(String(data.projectId))!.data.status))) ctx.fail(409, 'PROJECT_CLOSED', 'The project is closed');
    return { ...data, source: 'manual' };
  },
  afterSave: (ctx, { record }) => recompute(ctx, String(record.data.projectId)) };

interface QLine { desc: string; qty: number; unit?: string; unitPrice: number }
function totals(ctx: HookCtx, data: Record<string, unknown>) {
  const subtotal = ((data.lines as { qty?: number; unitPrice: number }[]) ?? []).reduce((a, l) => a + (l.qty ?? 1) * l.unitPrice, 0);
  const discount = Number(data.discount ?? 0); if (discount > subtotal) ctx.fail(400, 'VALIDATION_ERROR', 'discount cannot exceed the subtotal');
  const tax = applyBasisPoints(subtotal - discount, Number(data.taxBp ?? 0));
  return { ...data, discount, taxBp: Number(data.taxBp ?? 0), subtotal, tax, total: subtotal - discount + tax };
}
const Q_NEXT: Record<string, string[]> = { draft: ['sent', 'rejected'], sent: ['accepted', 'rejected', 'expired'] };
const QKEYS = ['lines', 'discount', 'taxBp', 'title', 'clientId'];
const quotation: EntityDef = { key: 'quotation', module: 'quotations', labelEn: 'Quotation', labelAr: 'عرض سعر', titleField: 'title', subtitleField: '$code', autoCode: 'QT-', searchFields: ['title'], filterable: ['status', 'clientId'], noDelete: true,
  immutableWhen: { field: 'status', values: ['accepted', 'rejected', 'expired'] },
  fields: { clientId: { type: 'ref', entity: 'client', required: true }, title: { type: 'string', required: true }, validUntil: { type: 'date' }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 200, fields: { desc: { type: 'string', required: true }, qty: { type: 'int', min: 1, required: true }, unit: { type: 'string', max: 20 }, unitPrice: { type: 'money', required: true } } },
    discount: { type: 'money', default: 0 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 }, status: { type: 'enum', values: ['draft', 'sent', 'accepted', 'rejected', 'expired'], default: 'draft' },
    subtotal: { type: 'money', readonly: true }, tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true }, projectId: { type: 'ref', entity: 'project', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') return { ...totals(ctx, data), status: 'draft' };
    const prev = String(existing!.data.status), next = String(data.status);
    if (next !== prev && !Q_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change quotation from ${prev} to ${next}`);
    if (prev === 'sent' && QKEYS.some((k) => JSON.stringify(data[k] ?? null) !== JSON.stringify(existing!.data[k] ?? null))) ctx.fail(409, 'IMMUTABLE', 'A sent quotation can only change status');
    return prev === 'draft' ? totals(ctx, data) : data;
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create' || record.data.status === previous!.data.status || record.data.status !== 'accepted') return;
    const p = ctx.create('project', { name: record.data.title, clientId: record.data.clientId, status: 'planning', showInPortfolio: false, contractValue: record.data.total, actualCost: 0, budget: 0, progressPct: 0, overBudget: false });
    ctx.patch(record.id, { projectId: p.id });
  } };

const PO_NEXT: Record<string, string[]> = { draft: ['ordered', 'cancelled'], ordered: ['received', 'cancelled'] };
const purchaseOrder: EntityDef = { key: 'purchaseOrder', module: 'purchasing', labelEn: 'Purchase order', labelAr: 'أمر شراء', titleField: '$code', subtitleField: 'status', autoCode: 'PO-', noDelete: true, filterable: ['status', 'supplierId', 'projectId'],
  immutableWhen: { field: 'status', values: ['received', 'cancelled'] },
  fields: { supplierId: { type: 'ref', entity: 'supplier', required: true }, projectId: { type: 'ref', entity: 'project' }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 200, fields: { materialId: { type: 'ref', entity: 'material', required: true }, qty: { type: 'int', min: 1, required: true }, unitCost: { type: 'money', required: true } } },
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
    if (action === 'create' || record.data.status === previous!.data.status || record.data.status !== 'received') return;
    for (const l of record.data.lines as { materialId: string; qty: number }[]) ctx.createFull('materialMovement', { materialId: l.materialId, type: 'in', qty: l.qty, reason: `PO ${record.code}` });
    if (record.data.projectId) bookExpense(ctx, { projectId: String(record.data.projectId), category: 'material', amount: Number(record.data.total), date: day(ctx), description: `Purchase ${record.code}`, source: 'purchase' });
  } };

const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 <= b2 && b1 <= a2;
const assignment: EntityDef = { key: 'assignment', module: 'assignments', labelEn: 'Work assignment', labelAr: 'تكليف', titleField: 'role', filterable: ['workerId', 'projectId'],
  fields: { workerId: { type: 'ref', entity: 'worker', required: true }, projectId: { type: 'ref', entity: 'project', required: true }, startDate: { type: 'date', required: true }, endDate: { type: 'date', required: true }, role: { type: 'string' } },
  beforeSave: (ctx, { data, existing }) => {
    if (String(data.endDate) < String(data.startDate)) ctx.fail(400, 'VALIDATION_ERROR', 'endDate cannot be before startDate');
    for (const o of ctx.find('assignment', { workerId: data.workerId })) if (o.id !== existing?.id && overlaps(String(data.startDate), String(data.endDate), String(o.data.startDate), String(o.data.endDate))) ctx.fail(409, 'WORKER_BUSY', 'The worker is already assigned in this period');
  } };
const workLog: EntityDef = { key: 'workLog', module: 'workLogs', labelEn: 'Work log', labelAr: 'سجل عمل', titleField: 'date', filterable: ['workerId', 'projectId', 'date'], noUpdate: true, noDelete: true,
  fields: { workerId: { type: 'ref', entity: 'worker', required: true, unique: true }, projectId: { type: 'ref', entity: 'project', required: true }, date: { type: 'date', required: true, unique: true }, hours: { type: 'int', min: 1, max: 24, required: true }, cost: { type: 'money', readonly: true } },
  beforeSave: (ctx, { data }) => ({ ...data, cost: Math.floor((Number(ctx.get(String(data.workerId))!.data.dailyRate) * Number(data.hours) + 4) / 8) }),
  afterSave: (ctx, { record }) => bookExpense(ctx, { projectId: String(record.data.projectId), category: 'labor', amount: Number(record.data.cost), date: String(record.data.date), description: `Labour ${record.data.hours}h`, source: 'labor' }) };

const invoice: EntityDef = { key: 'invoice', module: 'invoices', labelEn: 'Invoice', labelAr: 'فاتورة', titleField: '$code', subtitleField: 'status', autoCode: 'INV-', noDelete: true, filterable: ['status', 'clientId', 'projectId'],
  immutableWhen: { field: 'status', values: ['paid', 'cancelled'] },
  fields: { clientId: { type: 'ref', entity: 'client', required: true }, projectId: { type: 'ref', entity: 'project' }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 200, fields: { desc: { type: 'string', required: true }, qty: { type: 'int', min: 1, default: 1 }, unitPrice: { type: 'money', required: true } } },
    discount: { type: 'money', default: 0 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 }, status: { type: 'enum', values: ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'], default: 'draft' },
    subtotal: { type: 'money', readonly: true }, tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true }, paidAmount: { type: 'money', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') return { ...totals(ctx, data), status: 'draft', paidAmount: 0 };
    const prev = String(existing!.data.status), next = String(data.status);
    if (prev !== 'draft') {
      const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(existing!.data[k]));
      if (changed.some((k) => k !== 'status') || (next !== prev && !(next === 'cancelled' && Number(existing!.data.paidAmount) === 0))) ctx.fail(409, 'IMMUTABLE', 'Issued invoices can only be cancelled (when unpaid)');
    } else if (!['draft', 'issued', 'cancelled'].includes(next)) ctx.fail(409, 'INVALID_TRANSITION', 'A draft invoice can only be issued or cancelled');
    return { ...totals(ctx, data), paidAmount: existing!.data.paidAmount };
  } };
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true, filterable: ['invoiceId', 'method', 'projectId'],
  fields: { invoiceId: { type: 'ref', entity: 'invoice', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer', 'cheque'], required: true }, paidAt: { type: 'datetime' }, projectId: { type: 'ref', entity: 'project', readonly: true } },
  beforeSave: (ctx, { data }) => {
    const inv = ctx.get(String(data.invoiceId))!;
    if (!['issued', 'partially_paid'].includes(String(inv.data.status))) ctx.fail(409, 'INVOICE_NOT_PAYABLE', 'Payments can only be recorded on issued invoices');
    if (Number(data.amount) > Number(inv.data.total) - Number(inv.data.paidAmount)) ctx.fail(409, 'OVERPAYMENT', 'Payment exceeds the outstanding balance');
    return { ...data, paidAt: data.paidAt ?? ctx.now.toISOString(), ...(inv.data.projectId ? { projectId: inv.data.projectId } : {}) };
  },
  afterSave: (ctx, { record }) => { const inv = ctx.get(String(record.data.invoiceId))!; const paid = Number(inv.data.paidAmount) + Number(record.data.amount); ctx.patch(inv.id, { paidAmount: paid, status: paid >= Number(inv.data.total) ? 'paid' : 'partially_paid' }); } };

const quoteRequest: EntityDef = { key: 'quoteRequest', module: 'quoteRequests', labelEn: 'Quote request', labelAr: 'طلب عرض سعر', titleField: 'name', searchFields: ['name', 'phone', 'projectType'], filterable: ['status', 'kind'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' }, projectType: { type: 'string' }, location: { type: 'string' }, message: { type: 'text' }, preferredDate: { type: 'date' }, kind: { type: 'enum', values: ['quote', 'inspection'], default: 'quote' }, status: { type: 'enum', values: ['new', 'contacted', 'closed'], default: 'new' } } };
const inquiry: EntityDef = { key: 'inquiry', module: 'inquiries', labelEn: 'Inquiry', labelAr: 'استفسار', titleField: 'name', searchFields: ['name', 'phone', 'message'], filterable: ['status'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' }, message: { type: 'text', required: true }, status: { type: 'enum', values: ['new', 'handled'], default: 'new' } } };

const CT_NEXT: Record<string, string[]> = { draft: ['active', 'terminated'], active: ['completed', 'terminated'] };
/** Signed contract of a project. Only one is active per project; activating it sets the project's contract value. */
const contract: EntityDef = { key: 'contract', module: 'contracts', labelEn: 'Contract', labelAr: 'عقد', titleField: '$code', subtitleField: 'status', autoCode: 'CT-', noDelete: true, searchFields: ['title'], filterable: ['projectId', 'status'],
  immutableWhen: { field: 'status', values: ['completed', 'terminated'] },
  fields: { projectId: { type: 'ref', entity: 'project', required: true }, title: { type: 'string', required: true, max: 200 }, value: { type: 'money', required: true, min: 1 }, signedDate: { type: 'date' }, startDate: { type: 'date' }, endDate: { type: 'date' },
    retentionBp: { type: 'int', min: 0, max: 10000, default: 0 }, terms: { type: 'text' }, status: { type: 'enum', values: ['draft', 'active', 'completed', 'terminated'], default: 'draft' } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (data.startDate && data.endDate && String(data.endDate) < String(data.startDate)) ctx.fail(400, 'VALIDATION_ERROR', 'endDate cannot be before startDate');
    const prev = existing ? String(existing.data.status) : 'draft', next = String(data.status ?? 'draft');
    if (action === 'create' && next !== 'draft') ctx.fail(409, 'INVALID_TRANSITION', 'A new contract starts as a draft');
    if (action === 'update') {
      if (next !== prev && !CT_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change contract from ${prev} to ${next}`);
      if (prev !== 'draft' && (Number(data.value) !== Number(existing!.data.value) || data.projectId !== existing!.data.projectId)) ctx.fail(409, 'LOCKED', 'The value and project of a signed contract cannot change');
    }
    if (next === 'active' && prev !== 'active') {
      if (ctx.find('contract', { projectId: data.projectId, status: 'active' }).some((c) => c.id !== existing?.id)) ctx.fail(409, 'CONTRACT_EXISTS', 'This project already has an active contract');
      if (['completed', 'cancelled'].includes(String(ctx.get(String(data.projectId))!.data.status))) ctx.fail(409, 'PROJECT_CLOSED', 'The project is closed');
    }
  },
  afterSave: (ctx, { record, previous }) => { if (record.data.status === 'active' && previous?.data.status !== 'active') ctx.patch(String(record.data.projectId), { contractValue: record.data.value }); } };

const CL_NEXT: Record<string, string[]> = { draft: ['submitted'], submitted: ['approved', 'rejected'], approved: ['paid'] };
/** Progress claim (مستخلص): cumulative value of work to date; the claim amount is the increase over what was already approved, less retention and deductions. */
const progressClaim: EntityDef = { key: 'progressClaim', module: 'progressClaims', labelEn: 'Progress claim', labelAr: 'مستخلص', titleField: '$code', subtitleField: 'status', autoCode: 'PC-', noDelete: true, approvals: { field: 'status', values: ['approved', 'rejected'] }, filterable: ['projectId', 'status', 'contractId'],
  immutableWhen: { field: 'status', values: ['paid', 'rejected'] },
  fields: { projectId: { type: 'ref', entity: 'project', required: true }, contractId: { type: 'ref', entity: 'contract' }, periodTo: { type: 'date', required: true }, cumulativeValue: { type: 'money', required: true, min: 1 },
    retentionBp: { type: 'int', min: 0, max: 10000 }, deductions: { type: 'money', min: 0, default: 0 }, notes: { type: 'text' }, status: { type: 'enum', values: ['draft', 'submitted', 'approved', 'rejected', 'paid'], default: 'draft' },
    no: { type: 'int', readonly: true }, previousCumulative: { type: 'money', readonly: true }, grossAmount: { type: 'money', readonly: true }, retentionAmount: { type: 'money', readonly: true }, netAmount: { type: 'money', readonly: true }, paidAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    const approvedMax = (projectId: string, except?: string) => ctx.find('progressClaim', { projectId }).filter((c) => c.id !== except && ['approved', 'paid'].includes(String(c.data.status))).reduce((m, c) => Math.max(m, Number(c.data.cumulativeValue)), 0);
    if (action === 'create') {
      const p = ctx.get(String(data.projectId))!; if (['completed', 'cancelled'].includes(String(p.data.status))) ctx.fail(409, 'PROJECT_CLOSED', 'The project is closed');
      const prev = approvedMax(p.id), cum = Number(data.cumulativeValue); if (cum <= prev) ctx.fail(409, 'NOT_INCREASING', 'The cumulative value must exceed what was already approved');
      let bp = data.retentionBp === undefined ? 0 : Number(data.retentionBp);
      if (data.contractId) {
        const c = ctx.get(String(data.contractId))!; if (c.data.projectId !== p.id) ctx.fail(400, 'VALIDATION_ERROR', 'The contract belongs to another project'); if (c.data.status !== 'active') ctx.fail(409, 'CONTRACT_NOT_ACTIVE', 'The contract is not active');
        if (cum > Number(c.data.value)) ctx.fail(409, 'EXCEEDS_CONTRACT', 'The cumulative value exceeds the contract value'); if (data.retentionBp === undefined) bp = Number(c.data.retentionBp ?? 0);
      }
      const gross = cum - prev, retention = applyBasisPoints(gross, bp), net = gross - retention - Number(data.deductions ?? 0); if (net < 0) ctx.fail(400, 'VALIDATION_ERROR', 'Deductions exceed the claim amount');
      return { ...data, status: 'draft', no: ctx.find('progressClaim', { projectId: p.id }).length + 1, retentionBp: bp, previousCumulative: prev, grossAmount: gross, retentionAmount: retention, netAmount: net };
    }
    const prev = String(existing!.data.status), next = String(data.status); if (next === prev) return existing!.data; // amounts are frozen once created: only the status moves
    if (!CL_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change claim from ${prev} to ${next}`);
    const out: Record<string, unknown> = { ...existing!.data, status: next };
    if (next === 'approved' && approvedMax(String(existing!.data.projectId), existing!.id) !== Number(existing!.data.previousCumulative)) ctx.fail(409, 'STALE_CLAIM', 'Another claim was approved meanwhile; create a new claim from the current position');
    if (next === 'paid') out.paidAt = ctx.now.toISOString();
    return out;
  } };

const teamMember = simple('teamMember', 'team', 'Team member', 'عضو فريق', { name: { type: 'string', required: true }, title: { type: 'string' }, bio: { type: 'text' }, photoUrl: { type: 'url' }, position: { type: 'int', default: 0 }, active: { type: 'bool', default: true } },
  { searchFields: ['name', 'title'], filterable: ['active'], public: { fields: ['name', 'title', 'bio', 'photoUrl', 'position'], filter: { active: true } } });
const companyService = simple('service', 'services', 'Service', 'خدمة', { name: { type: 'string', required: true }, description: { type: 'text' }, position: { type: 'int', default: 0 }, active: { type: 'bool', default: true } },
  { searchFields: ['name'], filterable: ['active'], public: { fields: ['name', 'description', 'position'], filter: { active: true } } });

export const construction: ProductDef = {
  slug: 'construction',
  entities: [client, supplier, worker, warehouse, material, materialMovement, warehouseStockLedger, materialTransfer, boqEstimate, project, milestone, task, budgetLine, expense, quotation, purchaseOrder, assignment, workLog, invoice, payment, quoteRequest, inquiry, contract, progressClaim, teamMember, companyService],
  kpis: [
    { key: 'activeProjects', labelEn: 'Active projects', labelAr: 'مشروعات جارية', entity: 'project', agg: 'count', where: { status: 'active' } },
    { key: 'claimsDue', labelEn: 'Approved claims awaiting payment', labelAr: 'مستخلصات معتمدة بانتظار الصرف', entity: 'progressClaim', agg: 'sum', field: 'netAmount', where: { status: 'approved' }, money: true },
    { key: 'overBudgetProjects', labelEn: 'Over-budget projects', labelAr: 'مشروعات تجاوزت الميزانية', entity: 'project', agg: 'count', where: { overBudget: true } },
    { key: 'revenueMonth', labelEn: 'Collected this month', labelAr: 'تحصيلات الشهر', entity: 'payment', agg: 'sum', field: 'amount', period: 'month', dateField: 'paidAt', money: true },
    { key: 'expensesMonth', labelEn: 'Expenses this month', labelAr: 'مصروفات الشهر', entity: 'expense', agg: 'sum', field: 'amount', period: 'month', dateField: 'date', money: true },
    { key: 'outstanding', labelEn: 'Outstanding invoices', labelAr: 'فواتير مستحقة', entity: 'invoice', agg: 'sum', field: 'total', minusField: 'paidAmount', where: { status: ['issued', 'partially_paid'] }, money: true },
  ],
  reports: [
    { key: 'projectsByStatus', labelEn: 'Projects by status', labelAr: 'المشروعات حسب الحالة', entity: 'project', groupBy: 'status', agg: 'count' },
    { key: 'tasksByStatus', labelEn: 'Tasks by status', labelAr: 'المهام حسب الحالة', entity: 'task', groupBy: 'status', agg: 'count' },
    { key: 'costByCategory', labelEn: 'Cost by category', labelAr: 'التكلفة حسب البند', entity: 'expense', groupBy: 'category', agg: 'sum', field: 'amount' },
    { key: 'revenueByProject', labelEn: 'Collections by project', labelAr: 'التحصيلات حسب المشروع', entity: 'payment', groupBy: 'projectId', agg: 'sum', field: 'amount' },
  ],
  publicForms: [{ key: 'quoteRequest', entity: 'quoteRequest', fields: ['name', 'phone', 'email', 'projectType', 'location', 'message'] },
    { key: 'inspection', entity: 'quoteRequest', fields: ['name', 'phone', 'email', 'projectType', 'location', 'preferredDate', 'message'], defaults: { kind: 'inspection' } }, { key: 'inquiry', entity: 'inquiry', fields: ['name', 'phone', 'email', 'message'] }],
  employeeModules: { clients: ['read', 'create', 'update'], projects: ['read'], tasks: ['read', 'create', 'update'], milestones: ['read'], materials: ['read'], materialStock: ['read', 'create'], warehouses: ['read'], workers: ['read'], assignments: ['read'],
    workLogs: ['read', 'create'], expenses: ['read', 'create'], quotations: ['read', 'create', 'update'], invoices: ['read'], quoteRequests: ['read', 'update'], contracts: ['read'], progressClaims: ['read'], inquiries: ['read', 'update'] },
};
export type { QLine };
