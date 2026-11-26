import { applyBasisPoints } from '@codela/shared';
import { eq } from 'drizzle-orm';
import { tenants } from '@codela/db';
import { latinDigits, validateData, type EntityDef, type HookCtx, type ProductDef } from '../framework';

const menuCategory: EntityDef = { key: 'menuCategory', module: 'menuCategories', labelEn: 'Menu category', labelAr: 'قسم المنيو', titleField: 'name', searchFields: ['name'], filterable: ['active'],
  fields: { name: { type: 'string', required: true, unique: true }, sortOrder: { type: 'int', min: 0, default: 0 }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'sortOrder'], filter: { active: true } } };
const menuItem: EntityDef = { key: 'menuItem', module: 'menuItems', labelEn: 'Menu item', labelAr: 'صنف', titleField: 'name', searchFields: ['name', 'description'], filterable: ['categoryId', 'available'],
  fields: { name: { type: 'string', required: true }, categoryId: { type: 'ref', entity: 'menuCategory', required: true }, description: { type: 'text' }, price: { type: 'money', required: true }, image: { type: 'url' },
    extras: { type: 'lines', max: 30, fields: { name: { type: 'string', required: true }, price: { type: 'money', required: true } } }, prepTimeMin: { type: 'int', min: 0, max: 600 }, available: { type: 'bool', default: true } },
  public: { fields: ['name', 'categoryId', 'description', 'price', 'image', 'extras', 'prepTimeMin'], filter: { available: true }, filterable: ['categoryId'] } };
const branch: EntityDef = { key: 'branch', module: 'branches', labelEn: 'Branch', labelAr: 'فرع', titleField: 'name', searchFields: ['name', 'address'],
  fields: { name: { type: 'string', required: true }, address: { type: 'string' }, phone: { type: 'phone' }, hours: { type: 'string' }, mapUrl: { type: 'url' } },
  public: { fields: ['name', 'address', 'phone', 'hours', 'mapUrl'] } };
const restaurantTable: EntityDef = { key: 'restaurantTable', module: 'tables', labelEn: 'Table', labelAr: 'طاولة', titleField: 'number', searchFields: ['number', 'zone'], filterable: ['status', 'zone'],
  fields: { number: { type: 'string', required: true, unique: true, max: 20 }, seats: { type: 'int', min: 1, max: 100, required: true }, zone: { type: 'string' },
    status: { type: 'enum', values: ['free', 'occupied', 'reserved', 'out_of_service'], default: 'free' } } };

const ingredient: EntityDef = { key: 'ingredient', module: 'ingredients', labelEn: 'Ingredient', labelAr: 'مكوّن', titleField: 'name', searchFields: ['name'], filterable: ['unit'],
  fields: { name: { type: 'string', required: true, unique: true }, unit: { type: 'enum', values: ['g', 'kg', 'ml', 'l', 'pcs'], required: true }, stock: { type: 'int', readonly: true }, reorderLevel: { type: 'int', min: 0 }, unitCost: { type: 'money', default: 0 } }, // cost per stock unit (last purchase price)
  beforeSave: (_c, { action, data, existing }) => ({ ...data, stock: action === 'create' ? 0 : existing!.data.stock }) };
const PLUS = ['in', 'adjust_up'];
const branchBalance = (ctx: HookCtx, ingredientId: string, branchId: string) => ctx.find('branchStockLedger', { ingredientId, branchId }).reduce((a, r) => a + Number(r.data.delta ?? 0), 0);
const ingredientMovement: EntityDef = { key: 'ingredientMovement', module: 'stock', labelEn: 'Ingredient movement', labelAr: 'حركة مكوّن', titleField: '$code', subtitleField: 'type', autoCode: 'IM-', noUpdate: true, noDelete: true, filterable: ['ingredientId', 'type', 'source', 'branchId'],
  fields: { branchId: { type: 'ref', entity: 'branch' }, ingredientId: { type: 'ref', entity: 'ingredient', required: true }, type: { type: 'enum', values: ['in', 'out', 'waste', 'adjust_up', 'adjust_down'], required: true }, qty: { type: 'int', min: 1, required: true }, reason: { type: 'string' }, orderId: { type: 'ref', entity: 'order' }, purchaseId: { type: 'ref', entity: 'purchase' },
    unitCost: { type: 'money' }, cost: { type: 'money', readonly: true }, source: { type: 'string', readonly: true }, at: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { data }) => {
    const ing = ctx.get(String(data.ingredientId))!; const cur = Number(ing.data.stock ?? 0); if (!PLUS.includes(String(data.type)) && Number(data.qty) > cur) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${cur} in stock`);
    // a branch movement can only draw on that branch's own balance, never on another branch's stock
    if (data.branchId && !PLUS.includes(String(data.type))) { const b = branchBalance(ctx, ing.id, String(data.branchId)); if (Number(data.qty) > b) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${b} in stock at this branch`); }
    // cost is a snapshot (qty x unit cost at that moment); the source tells the profit report where it came from
    const unit = data.unitCost !== undefined && data.unitCost !== null ? Number(data.unitCost) : Number(ing.data.unitCost ?? 0);
    const source = data.orderId ? (data.type === 'out' ? 'order' : 'order_return') : data.purchaseId ? 'purchase' : 'manual';
    return { ...data, cost: Number(data.qty) * unit, source, at: ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => {
    const i = ctx.get(String(record.data.ingredientId))!; const sign = PLUS.includes(String(record.data.type)) ? 1 : -1;
    ctx.patch(i.id, { stock: Number(i.data.stock ?? 0) + sign * Number(record.data.qty) });
    if (record.data.branchId) ctx.create('branchStockLedger', { ingredientId: i.id, branchId: record.data.branchId, delta: sign * Number(record.data.qty), kind: 'movement', movementId: record.id, at: ctx.now.toISOString() });
  } };
/** Per-branch stock ledger. System-written only (movements and transfers); the balance of a branch is the sum of its rows. Total ingredient stock stays the sum over all branches plus unassigned movements. */
const branchStockLedger: EntityDef = { key: 'branchStockLedger', module: 'stock', labelEn: 'Branch stock ledger', labelAr: 'دفتر مخزون الفرع', titleField: '$code', subtitleField: 'kind', autoCode: 'BSL-', noCreate: true, noUpdate: true, noDelete: true, filterable: ['ingredientId', 'branchId', 'kind'],
  fields: { ingredientId: { type: 'ref', entity: 'ingredient', readonly: true }, branchId: { type: 'ref', entity: 'branch', readonly: true }, delta: { type: 'int', readonly: true }, kind: { type: 'string', readonly: true }, movementId: { type: 'string', readonly: true }, transferId: { type: 'string', readonly: true }, at: { type: 'datetime', readonly: true } } };
/** Moves stock between two branches: one atomic record that writes both ledger rows (out of the source, into the target). Total stock is unchanged. */
const ingredientTransfer: EntityDef = { key: 'ingredientTransfer', module: 'stock', labelEn: 'Branch stock transfer', labelAr: 'تحويل مخزون بين الفروع', titleField: '$code', autoCode: 'TRF-', noUpdate: true, noDelete: true, filterable: ['ingredientId', 'fromBranchId', 'toBranchId'],
  fields: { ingredientId: { type: 'ref', entity: 'ingredient', required: true }, fromBranchId: { type: 'ref', entity: 'branch', required: true }, toBranchId: { type: 'ref', entity: 'branch', required: true }, qty: { type: 'int', min: 1, required: true }, note: { type: 'string', max: 200 } },
  beforeSave: (ctx, { data }) => {
    if (data.fromBranchId === data.toBranchId) ctx.fail(400, 'VALIDATION_ERROR', 'The source and target branches must differ');
    const b = branchBalance(ctx, String(data.ingredientId), String(data.fromBranchId));
    if (Number(data.qty) > b) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${b} in stock at the source branch`);
  },
  afterSave: (ctx, { record }) => {
    const d = record.data, at = ctx.now.toISOString();
    ctx.create('branchStockLedger', { ingredientId: d.ingredientId, branchId: d.fromBranchId, delta: -Number(d.qty), kind: 'transfer_out', transferId: record.id, at });
    ctx.create('branchStockLedger', { ingredientId: d.ingredientId, branchId: d.toBranchId, delta: Number(d.qty), kind: 'transfer_in', transferId: record.id, at });
  } };
const recipe: EntityDef = { key: 'recipe', module: 'recipes', labelEn: 'Recipe', labelAr: 'وصفة', titleField: '$code', autoCode: 'RCP-',
  fields: { itemId: { type: 'ref', entity: 'menuItem', required: true, unique: true }, lines: { type: 'lines', required: true, max: 50, fields: { ingredientId: { type: 'ref', entity: 'ingredient', required: true }, qty: { type: 'int', min: 1, required: true } } } } };

const supplier: EntityDef = { key: 'supplier', module: 'suppliers', labelEn: 'Supplier', labelAr: 'مورد', titleField: 'name', searchFields: ['name', 'phone'],
  fields: { name: { type: 'string', required: true, unique: true }, phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' }, notes: { type: 'text' } } };
/** Purchase of raw materials: totals are computed on the server; receiving it adds every line to the ingredient stock ledger exactly once. */
const purchase: EntityDef = { key: 'purchase', module: 'purchasing', labelEn: 'Purchase invoice', labelAr: 'فاتورة مشتريات', titleField: '$code', subtitleField: 'status', autoCode: 'PUR-', searchFields: ['reference'], noDelete: true,
  filterable: ['status', 'supplierId'], immutableWhen: { field: 'status', values: ['received', 'cancelled'] },
  fields: { supplierId: { type: 'ref', entity: 'supplier', required: true }, reference: { type: 'string', max: 60 }, notes: { type: 'text' },
    lines: { type: 'lines', required: true, max: 50, fields: { ingredientId: { type: 'ref', entity: 'ingredient', required: true }, qty: { type: 'int', min: 1, required: true }, unitCost: { type: 'money', required: true } } },
    status: { type: 'enum', values: ['draft', 'received', 'cancelled'], default: 'draft' }, total: { type: 'money', readonly: true }, receivedAt: { type: 'datetime', readonly: true },
    paidAmount: { type: 'money', readonly: true }, paymentStatus: { type: 'enum', values: ['unpaid', 'partial', 'paid'], readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const lines = data.lines as { qty: number; unitCost: number }[];
      return { ...data, status: 'draft', paidAmount: 0, paymentStatus: 'unpaid', total: lines.reduce((a, l) => a + l.qty * l.unitCost, 0) };
    }
    const out: Record<string, unknown> = { ...existing!.data }; for (const k of ['status', 'notes', 'reference']) if (k in data) out[k] = data[k]; // lines and prices are fixed once created
    if (out.status !== existing!.data.status) {
      if (existing!.data.status !== 'draft') ctx.fail(409, 'INVALID_TRANSITION', 'Only a draft purchase can be received or cancelled');
      if (out.status === 'received') out.receivedAt = ctx.now.toISOString();
    }
    return out;
  },
  afterSave: (ctx, { record, previous }) => {
    if (record.data.status === 'received' && previous && previous.data.status !== 'received')
      for (const l of record.data.lines as { ingredientId: string; qty: number; unitCost: number }[]) { ctx.patch(l.ingredientId, { unitCost: l.unitCost }); ctx.createFull('ingredientMovement', { ingredientId: l.ingredientId, type: 'in', qty: l.qty, unitCost: l.unitCost, purchaseId: record.id, reason: `purchase ${record.code}` }); }
  } };
const supplierPayment: EntityDef = { key: 'supplierPayment', module: 'purchasing', labelEn: 'Supplier payment', labelAr: 'دفعة مورد', titleField: '$code', subtitleField: 'method', autoCode: 'SP-', noUpdate: true, noDelete: true, filterable: ['supplierId', 'purchaseId', 'method'],
  fields: { purchaseId: { type: 'ref', entity: 'purchase', required: true }, supplierId: { type: 'ref', entity: 'supplier', readonly: true }, amount: { type: 'money', required: true }, method: { type: 'enum', values: ['cash', 'bank', 'wallet'], required: true }, reference: { type: 'string', max: 80 } },
  beforeSave: (ctx, { data }) => {
    const p = ctx.get(String(data.purchaseId))!; if (p.data.status !== 'received') ctx.fail(409, 'NOT_RECEIVED', 'Only a received purchase can be paid');
    const due = Number(p.data.total) - Number(p.data.paidAmount ?? 0); if (Number(data.amount) <= 0) ctx.fail(400, 'VALIDATION_ERROR', 'amount must be positive'); if (Number(data.amount) > due) ctx.fail(409, 'OVERPAYMENT', `Only ${due} is outstanding`);
    return { ...data, supplierId: p.data.supplierId };
  },
  afterSave: (ctx, { record }) => { const p = ctx.get(String(record.data.purchaseId))!; const paid = Number(p.data.paidAmount ?? 0) + Number(record.data.amount); ctx.patch(p.id, { paidAmount: paid, paymentStatus: paid >= Number(p.data.total) ? 'paid' : 'partial' }); } };
/** Split bills: several payments (cash + card ...) that together settle one order. When they add up to the total the order is paid and its invoice is issued. */
const orderPayment: EntityDef = { key: 'orderPayment', module: 'orders', labelEn: 'Order payment', labelAr: 'دفعة طلب', titleField: '$code', subtitleField: 'method', autoCode: 'OP-', noUpdate: true, noDelete: true, filterable: ['orderId', 'method'],
  fields: { orderId: { type: 'ref', entity: 'order', required: true }, amount: { type: 'money', required: true }, method: { type: 'enum', values: ['cash', 'card', 'online'], required: true } },
  beforeSave: (ctx, { data }) => {
    const o = ctx.get(String(data.orderId))!; if (o.data.paymentStatus === 'paid' || o.data.status === 'cancelled') ctx.fail(409, 'NOT_PAYABLE', 'This order cannot take payments');
    const paid = ctx.find('orderPayment', { orderId: o.id }).reduce((a, x) => a + Number(x.data.amount), 0); const rest = Number(o.data.total) - paid;
    if (Number(data.amount) <= 0) ctx.fail(400, 'VALIDATION_ERROR', 'amount must be positive'); if (Number(data.amount) > rest) ctx.fail(409, 'OVERPAYMENT', `Only ${rest} is outstanding`);
  },
  afterSave: (ctx, { record }) => {
    const o = ctx.get(String(record.data.orderId))!; const all = ctx.find('orderPayment', { orderId: o.id }); const paid = all.reduce((a, x) => a + Number(x.data.amount), 0);
    if (paid < Number(o.data.total)) return;
    const methods = [...new Set(all.map((x) => String(x.data.method)))];
    ctx.patch(o.id, { paymentStatus: 'paid', paymentMethod: methods.length === 1 ? methods[0] : 'mixed', paidAt: ctx.now.toISOString() });
    if (!ctx.find('invoice', { orderId: o.id }).length) ctx.create('invoice', { orderId: o.id, total: o.data.total, issuedAt: ctx.now.toISOString() });
  } };
const promotion: EntityDef = { key: 'promotion', module: 'promotions', labelEn: 'Offer', labelAr: 'عرض', titleField: 'title', searchFields: ['title'], filterable: ['active'],
  fields: { title: { type: 'string', required: true, max: 120 }, description: { type: 'text' }, validUntil: { type: 'date' }, active: { type: 'bool', default: true } },
  public: { fields: ['title', 'description', 'validUntil'], filter: { active: true } } };

interface OItem { itemId: string; name: string; qty: number; extras: string[]; unitPrice: number; lineTotal: number; note?: string }
const need = (ctx: HookCtx, items: OItem[]) => {
  const t = new Map<string, number>();
  for (const it of items) for (const r of ctx.find('recipe', { itemId: it.itemId })) for (const l of r.data.lines as { ingredientId: string; qty: number }[]) t.set(l.ingredientId, (t.get(l.ingredientId) ?? 0) + l.qty * it.qty);
  return t;
};
function priceLines(ctx: Pick<HookCtx, 'get' | 'fail'>, lines: { itemId: string; qty: number; extras?: string; note?: string }[]) {
  if (!lines?.length) ctx.fail(400, 'VALIDATION_ERROR', 'lines are required');
  return lines.map((l) => {
    const it = ctx.get(l.itemId); if (!it || it.entityType !== 'menuItem') ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown menu item');
    if (it!.data.available === false) ctx.fail(409, 'NOT_AVAILABLE', `${it!.data.name} is not available`);
    const defs = (it!.data.extras as { name: string; price: number }[] | undefined) ?? [];
    const chosen = String(l.extras ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((n) => {
      const e = defs.find((d) => d.name.toLowerCase() === n.toLowerCase()); if (!e) ctx.fail(400, 'VALIDATION_ERROR', `Unknown extra "${n}" for ${it!.data.name}`); return e!;
    });
    const unitPrice = Number(it!.data.price) + chosen.reduce((a, e) => a + e.price, 0);
    return { itemId: it!.id, name: String(it!.data.name), qty: l.qty, extras: chosen.map((e) => e.name), unitPrice, lineTotal: unitPrice * l.qty, ...(l.note ? { note: l.note } : {}) } as OItem;
  });
}
const OPEN = ['new', 'preparing', 'ready'];
const EDITABLE = ['status', 'paymentStatus', 'paymentMethod', 'notes', 'customerName', 'customerPhone', 'address', 'tableId'];
function nextStates(type: string, from: string): string[] {
  if (from === 'new') return ['preparing', 'cancelled'];
  if (from === 'preparing') return ['ready', 'cancelled'];
  if (from === 'ready') return type === 'dine_in' ? ['served'] : type === 'delivery' ? ['out_for_delivery'] : ['completed'];
  if (from === 'served' || from === 'out_for_delivery') return ['completed'];
  return [];
}
const order: EntityDef = { key: 'order', module: 'orders', labelEn: 'Order', labelAr: 'طلب', titleField: '$code', subtitleField: 'status', autoCode: 'ORD-', searchFields: ['customerName', 'customerPhone'], noDelete: true,
  filterable: ['status', 'type', 'paymentStatus', 'tableId', 'paymentMethod', 'branchId'], immutableWhen: { field: 'status', values: ['completed', 'cancelled'] },
  fields: { branchId: { type: 'ref', entity: 'branch' }, type: { type: 'enum', values: ['dine_in', 'takeaway', 'delivery'], required: true }, tableId: { type: 'ref', entity: 'restaurantTable' }, customerName: { type: 'string' }, customerPhone: { type: 'phone' }, address: { type: 'string' },
    channel: { type: 'enum', values: ['pos', 'online'], default: 'pos' },
    lines: { type: 'lines', required: true, max: 60, fields: { itemId: { type: 'ref', entity: 'menuItem', required: true }, qty: { type: 'int', min: 1, max: 99, required: true }, extras: { type: 'string', max: 300 }, note: { type: 'string', max: 300 } } },
    discount: { type: 'money', default: 0 }, serviceBp: { type: 'int', min: 0, max: 10000, default: 0 }, taxBp: { type: 'int', min: 0, max: 10000 }, notes: { type: 'text' },
    status: { type: 'enum', values: ['new', 'preparing', 'ready', 'served', 'out_for_delivery', 'completed', 'cancelled'], default: 'new' },
    paymentStatus: { type: 'enum', values: ['unpaid', 'paid'], default: 'unpaid' }, paymentMethod: { type: 'enum', values: ['cash', 'card', 'online', 'mixed'] },
    items: { type: 'lines', readonly: true, fields: {} }, subtotal: { type: 'money', readonly: true }, serviceCharge: { type: 'money', readonly: true }, tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true },
    placedAt: { type: 'datetime', readonly: true }, paidAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const type = String(data.type);
      if (type === 'dine_in') {
        if (!data.tableId) ctx.fail(400, 'VALIDATION_ERROR', 'tableId is required for dine-in orders');
        if (ctx.get(String(data.tableId))!.data.status === 'out_of_service') ctx.fail(409, 'TABLE_UNAVAILABLE', 'This table is out of service');
      }
      if (type === 'delivery' && (!data.customerPhone || !data.address)) ctx.fail(400, 'VALIDATION_ERROR', 'Delivery orders need customerPhone and address');
      const items = priceLines(ctx, data.lines as never); const subtotal = items.reduce((a, i) => a + i.lineTotal, 0);
      const discount = Number(data.discount ?? 0); if (discount > subtotal) ctx.fail(400, 'VALIDATION_ERROR', 'discount cannot exceed the subtotal');
      const base = subtotal - discount; const serviceCharge = applyBasisPoints(base, Number(data.serviceBp ?? 0));
      const taxBp = data.taxBp === undefined || data.taxBp === null ? tenantTaxBp(ctx) : Number(data.taxBp); // a POS order that does not state a rate gets the business's default tax
      const tax = applyBasisPoints(base + serviceCharge, taxBp);
      return { ...data, taxBp, discount, items, subtotal, serviceCharge, tax, total: base + serviceCharge + tax, status: 'new', paymentStatus: 'unpaid', placedAt: ctx.now.toISOString() };
    }
    const out: Record<string, unknown> = { ...existing!.data };
    for (const k of EDITABLE) if (k in data) out[k] = data[k];
    if (out.tableId !== existing!.data.tableId) { // table transfer: only a dine-in order that is still open, onto a free table
      if (existing!.data.type !== 'dine_in' || !OPEN.concat(['served']).includes(String(existing!.data.status))) ctx.fail(409, 'INVALID_TRANSITION', 'Only an open dine-in order can change table');
      const nt = out.tableId ? ctx.get(String(out.tableId)) : undefined; if (!nt) ctx.fail(400, 'VALIDATION_ERROR', 'tableId is required for dine-in orders');
      if (nt!.data.status !== 'free') ctx.fail(409, 'TABLE_BUSY', 'The target table is not free');
    }
    const prev = String(existing!.data.status), next = String(out.status);
    if (next !== prev) {
      if (!nextStates(String(out.type), prev).includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change order from ${prev} to ${next}`);
      if (next === 'completed' && out.paymentStatus !== 'paid') ctx.fail(409, 'UNPAID', 'The order must be paid before it is completed');
    }
    if (out.paymentStatus !== existing!.data.paymentStatus) {
      if (existing!.data.paymentStatus !== 'unpaid') ctx.fail(409, 'INVALID_TRANSITION', 'Paid orders cannot be reopened');
      if (!out.paymentMethod) ctx.fail(400, 'VALIDATION_ERROR', 'paymentMethod is required when marking an order paid');
      out.paidAt = ctx.now.toISOString();
    }
    return out;
  },
  afterSave: (ctx, { action, record, previous }) => {
    const d = record.data;
    if (action === 'create') { if (d.type === 'dine_in') ctx.patch(String(d.tableId), { status: 'occupied' }); return; }
    const was = previous!.data;
    if (d.tableId && was.tableId && d.tableId !== was.tableId) {
      const others = ctx.find('order', { tableId: was.tableId }).filter((o) => o.id !== record.id && OPEN.concat(['served']).includes(String(o.data.status)));
      const old = ctx.get(String(was.tableId))!; if (!others.length && old.data.status === 'occupied') ctx.patch(old.id, { status: 'free' });
      ctx.patch(String(d.tableId), { status: 'occupied' });
    }
    if (d.status !== was.status) {
      const sign = d.status === 'preparing' ? 'out' : d.status === 'cancelled' && was.status === 'preparing' ? 'in' : null;
      if (sign) for (const [ingredientId, qty] of need(ctx, d.items as OItem[])) ctx.createFull('ingredientMovement', { ingredientId, type: sign, qty, reason: `order ${record.code}`, orderId: record.id, ...(d.branchId ? { branchId: d.branchId } : {}) });
      if ((d.status === 'completed' || d.status === 'cancelled') && d.type === 'dine_in' && d.tableId) {
        const others = ctx.find('order', { tableId: d.tableId }).filter((o) => o.id !== record.id && OPEN.concat(['served']).includes(String(o.data.status)));
        const t = ctx.get(String(d.tableId))!; if (!others.length && t.data.status === 'occupied') ctx.patch(t.id, { status: 'free' });
      }
    }
    if (d.paymentStatus === 'paid' && was.paymentStatus !== 'paid' && !ctx.find('invoice', { orderId: record.id }).length) ctx.create('invoice', { orderId: record.id, total: d.total, issuedAt: ctx.now.toISOString() });
  } };
const invoice: EntityDef = { key: 'invoice', module: 'invoices', labelEn: 'Invoice', labelAr: 'فاتورة', titleField: '$code', autoCode: 'INV-', noCreate: true, noUpdate: true, noDelete: true, filterable: ['orderId'],
  fields: { orderId: { type: 'ref', entity: 'order', readonly: true }, total: { type: 'money', readonly: true }, issuedAt: { type: 'datetime', readonly: true } } };

const shift: EntityDef = { key: 'shift', module: 'shifts', labelEn: 'Cashier shift', labelAr: 'وردية', titleField: '$code', subtitleField: 'status', autoCode: 'SH-', noDelete: true, filterable: ['status'],
  immutableWhen: { field: 'status', values: ['closed'] },
  fields: { openingCash: { type: 'money', required: true }, status: { type: 'enum', values: ['open', 'closed'], default: 'open' }, closingCash: { type: 'money' },
    openedAt: { type: 'datetime', readonly: true }, closedAt: { type: 'datetime', readonly: true }, expectedCash: { type: 'money', readonly: true }, difference: { type: 'int', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      if (ctx.find('shift', { status: 'open' }).length) ctx.fail(409, 'SHIFT_OPEN', 'A cashier shift is already open');
      return { ...data, status: 'open', openedAt: ctx.now.toISOString() };
    }
    const out = { ...existing!.data, ...data };
    if (data.status === 'closed') {
      if (data.closingCash === undefined || data.closingCash === null) ctx.fail(400, 'VALIDATION_ERROR', 'closingCash is required to close the shift');
      const cash = ctx.find('order', { paymentStatus: 'paid', paymentMethod: 'cash' }).filter((o) => String(o.data.paidAt) >= String(existing!.data.openedAt)).reduce((a, o) => a + Number(o.data.total), 0);
      const expected = Number(existing!.data.openingCash) + cash;
      return { ...out, closedAt: ctx.now.toISOString(), expectedCash: expected, difference: Number(data.closingCash) - expected };
    }
    return out;
  } };

const RES_ACTIVE = ['requested', 'confirmed', 'seated'];
const RES_NEXT: Record<string, string[]> = { requested: ['confirmed', 'cancelled'], confirmed: ['seated', 'cancelled', 'no_show'], seated: ['completed'] };
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const reservation: EntityDef = { key: 'reservation', module: 'reservations', labelEn: 'Reservation', labelAr: 'حجز', titleField: 'name', subtitleField: '$code', autoCode: 'RS-', searchFields: ['name', 'phone', 'date'], filterable: ['status', 'date', 'tableId'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, date: { type: 'date', required: true }, time: { type: 'time', required: true }, partySize: { type: 'int', min: 1, max: 200, required: true },
    durationMin: { type: 'int', min: 15, max: 480, default: 90 }, tableId: { type: 'ref', entity: 'restaurantTable' }, notes: { type: 'text' },
    status: { type: 'enum', values: ['requested', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'], default: 'requested' } },
  beforeSave: (ctx, { action, data, existing }) => {
    const status = action === 'create' ? 'requested' : String(data.status);
    if (existing && status !== existing.data.status && !RES_NEXT[String(existing.data.status)]?.includes(status)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change reservation from ${existing.data.status} to ${status}`);
    if (status === 'confirmed' && !data.tableId) ctx.fail(409, 'TABLE_REQUIRED', 'Assign a table before confirming');
    if (data.tableId && RES_ACTIVE.includes(status)) {
      const t = ctx.get(String(data.tableId))!; if (Number(t.data.seats) < Number(data.partySize)) ctx.fail(409, 'TABLE_TOO_SMALL', `Table seats only ${t.data.seats}`);
      const s = hm(String(data.time)), e = s + Number(data.durationMin ?? 90);
      for (const o of ctx.find('reservation', { tableId: data.tableId, date: data.date })) {
        if (o.id === existing?.id || !RES_ACTIVE.includes(String(o.data.status))) continue;
        const os = hm(String(o.data.time)); if (s < os + Number(o.data.durationMin ?? 90) && os < e) ctx.fail(409, 'TABLE_TAKEN', 'The table is already reserved at this time');
      }
    }
    return { ...data, status };
  } };

const tenantTaxBp = (ctx: HookCtx) => ctx.db.select({ t: tenants.taxBp }).from(tenants).where(eq(tenants.id, ctx.tenantId)).get()?.t ?? 0;
const normPhone = (p: unknown) => latinDigits(String(p ?? '')).replace(/[\s\-().]/g, '');
export const restaurant: ProductDef = {
  slug: 'restaurant',
  entities: [menuCategory, menuItem, branch, restaurantTable, ingredient, ingredientMovement, branchStockLedger, ingredientTransfer, recipe, supplier, purchase, supplierPayment, orderPayment, promotion, order, invoice, shift, reservation],
  kpis: [
    { key: 'ordersToday', labelEn: 'Orders today', labelAr: 'طلبات اليوم', entity: 'order', agg: 'count', period: 'today', dateField: 'placedAt' },
    { key: 'salesToday', labelEn: 'Sales today', labelAr: 'مبيعات اليوم', entity: 'order', agg: 'sum', field: 'total', where: { paymentStatus: 'paid' }, period: 'today', dateField: 'paidAt', money: true },
    { key: 'openOrders', labelEn: 'Open orders', labelAr: 'طلبات مفتوحة', entity: 'order', agg: 'count', where: { status: ['new', 'preparing', 'ready'] } },
    { key: 'wasteEntries', labelEn: 'Waste entries this month', labelAr: 'تسجيلات الهالك هذا الشهر', entity: 'ingredientMovement', agg: 'count', where: { type: 'waste' }, period: 'month', dateField: 'at' },
    { key: 'salesMonth', labelEn: 'Sales this month', labelAr: 'مبيعات الشهر', entity: 'order', agg: 'sum', field: 'total', where: { paymentStatus: 'paid' }, period: 'month', dateField: 'paidAt', money: true },
    { key: '_cogsOut', labelEn: '', labelAr: '', entity: 'ingredientMovement', agg: 'sum', field: 'cost', where: { source: 'order' }, period: 'month', dateField: 'at', money: true, hidden: true },
    { key: '_cogsBack', labelEn: '', labelAr: '', entity: 'ingredientMovement', agg: 'sum', field: 'cost', where: { source: 'order_return' }, period: 'month', dateField: 'at', money: true, hidden: true },
    { key: 'cogsMonth', labelEn: 'Cost of goods sold (month)', labelAr: 'تكلفة المبيعات (الشهر)', entity: 'ingredientMovement', agg: 'sum', money: true, derived: { plus: ['_cogsOut'], minus: ['_cogsBack'] } },
    { key: 'wasteCostMonth', labelEn: 'Waste cost (month)', labelAr: 'تكلفة الهالك (الشهر)', entity: 'ingredientMovement', agg: 'sum', field: 'cost', where: { type: 'waste' }, period: 'month', dateField: 'at', money: true },
    { key: 'grossProfitMonth', labelEn: 'Gross profit (month)', labelAr: 'مجمل الربح (الشهر)', entity: 'ingredientMovement', agg: 'sum', money: true, derived: { plus: ['salesMonth'], minus: ['cogsMonth', 'wasteCostMonth'] } },
    { key: 'supplierDue', labelEn: 'Owed to suppliers', labelAr: 'مستحق للموردين', entity: 'purchase', agg: 'sum', field: 'total', minusField: 'paidAmount', where: { status: 'received' }, money: true },
    { key: 'tablesOccupied', labelEn: 'Occupied tables', labelAr: 'طاولات مشغولة', entity: 'restaurantTable', agg: 'count', where: { status: 'occupied' } },
  ],
  reports: [
    { key: 'stockByBranch', labelEn: 'Net stock movement by branch (all ingredients, stock units)', labelAr: 'صافي حركة المخزون لكل فرع (كل المكوّنات)', entity: 'branchStockLedger', groupBy: 'branchId', agg: 'sum', field: 'delta' },
    { key: 'ordersByStatus', labelEn: 'Orders by status', labelAr: 'الطلبات حسب الحالة', entity: 'order', groupBy: 'status', agg: 'count' },
    { key: 'ordersByType', labelEn: 'Orders by type', labelAr: 'الطلبات حسب النوع', entity: 'order', groupBy: 'type', agg: 'count' },
    { key: 'salesByMethod', labelEn: 'Sales by payment method', labelAr: 'المبيعات حسب طريقة الدفع', entity: 'order', groupBy: 'paymentMethod', agg: 'sum', field: 'total', where: { paymentStatus: 'paid' } },
  ],
  publicForms: [{ key: 'reservation', entity: 'reservation', fields: ['name', 'phone', 'date', 'time', 'partySize', 'notes'] }],
  publicActions: [
    { key: 'order', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
      if (!['takeaway', 'delivery'].includes(String(b.type))) ctx.fail(400, 'VALIDATION_ERROR', 'Online orders must be takeaway or delivery');
      const c = validateData({ fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true } } }, b.customer, { partial: false });
      if (Object.keys(c.errors).length) ctx.fail(400, 'VALIDATION_ERROR', Object.entries(c.errors).map(([k, v]) => `${k} ${v}`).join('; '));
      const o = ctx.createFull('order', { type: b.type, customerName: c.data.name, customerPhone: c.data.phone, address: b.address, lines: b.lines, channel: 'online', taxBp: tenantTaxBp(ctx) });
      return { orderCode: o.code, total: o.data.total, status: o.data.status };
    } },
    { key: 'track', method: 'GET', write: false, handler: (ctx, q) => {
      const o = ctx.byCode('order', String(q.code ?? '').toUpperCase());
      if (!o || !o.data.customerPhone || o.data.customerPhone !== normPhone(q.phone)) ctx.fail(404, 'NOT_FOUND', 'Order not found');
      return { code: o!.code, type: o!.data.type, status: o!.data.status, paymentStatus: o!.data.paymentStatus, total: o!.data.total, placedAt: o!.data.placedAt,
        items: (o!.data.items as OItem[]).map((i) => ({ name: i.name, qty: i.qty, extras: i.extras, lineTotal: i.lineTotal })) };
    } },
  ],
  employeeModules: { orders: ['read', 'create', 'update'], menuItems: ['read'], menuCategories: ['read'], tables: ['read', 'update'], reservations: ['read', 'create', 'update'], shifts: ['read', 'create', 'update'], invoices: ['read'], branches: ['read'], ingredients: ['read'] },
};
