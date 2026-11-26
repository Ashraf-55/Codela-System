import { applyBasisPoints } from '@codela/shared';
import { enqueue } from '../../outbox';
import { eq } from 'drizzle-orm';
import { tenants } from '@codela/db';
import { latinDigits, validateData, type EntityDef, type HookCtx, type ProductDef, type RecordRow } from '../framework';

const nameUnique = (key: string, module: string, en: string, ar: string, fields: EntityDef['fields'], extra: Partial<EntityDef> = {}): EntityDef => ({
  key, module, labelEn: en, labelAr: ar, titleField: 'name', searchFields: ['name'], fields: { name: { type: 'string', required: true, unique: true }, ...fields }, ...extra });

const category = nameUnique('category', 'categories', 'Category', 'تصنيف', { parentId: { type: 'ref', entity: 'category' } }, { public: { fields: ['name', 'parentId'] } });
const supplier = nameUnique('supplier', 'suppliers', 'Supplier', 'مورد', { phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' } });
const shippingMethod = nameUnique('shippingMethod', 'shipping', 'Shipping method', 'طريقة شحن', { fee: { type: 'money', required: true }, freeOver: { type: 'money' }, etaDays: { type: 'int', min: 0, max: 60 }, active: { type: 'bool', default: true } },
  { filterable: ['active'], public: { fields: ['name', 'fee', 'freeOver', 'etaDays'], filter: { active: true } } });
const paymentMethod = nameUnique('paymentMethod', 'paymentMethods', 'Payment method', 'طريقة دفع', { type: { type: 'enum', values: ['cod', 'card', 'transfer', 'wallet'], required: true }, active: { type: 'bool', default: true } },
  { filterable: ['active'], public: { fields: ['name', 'type'], filter: { active: true } } });

const product: EntityDef = { key: 'product', module: 'products', labelEn: 'Product', labelAr: 'منتج', titleField: 'name', subtitleField: '$code', autoCode: 'PRD-', searchFields: ['name', 'description'],
  filterable: ['categoryId', 'status', 'supplierId', 'basePrice', 'featured'],
  fields: { name: { type: 'string', required: true }, categoryId: { type: 'ref', entity: 'category' }, supplierId: { type: 'ref', entity: 'supplier' }, description: { type: 'text' }, basePrice: { type: 'money', required: true },
    compareAtPrice: { type: 'money' }, featured: { type: 'bool', default: false }, status: { type: 'enum', values: ['draft', 'active', 'archived'], default: 'draft' }, images: { type: 'lines', max: 20, fields: { url: { type: 'url', required: true }, caption: { type: 'string' } } } },
  public: { fields: ['name', 'categoryId', 'description', 'basePrice', 'compareAtPrice', 'featured', 'images'], filter: { status: 'active' }, filterable: ['categoryId', 'basePrice', 'featured'] } };

const variant: EntityDef = { key: 'variant', module: 'variants', labelEn: 'Variant', labelAr: 'نوع المنتج', titleField: 'sku', searchFields: ['sku'], filterable: ['productId', 'status', 'stock', 'lowStock'],
  fields: { productId: { type: 'ref', entity: 'product', required: true }, sku: { type: 'string', required: true, unique: true, max: 60 },
    attributes: { type: 'lines', max: 20, fields: { name: { type: 'string', required: true }, value: { type: 'string', required: true } } }, price: { type: 'money' },
    cost: { type: 'money', default: 0 }, reorderLevel: { type: 'int', min: 0 }, stock: { type: 'int', readonly: true }, lowStock: { type: 'bool', readonly: true }, status: { type: 'enum', values: ['active', 'inactive'], default: 'active' } },
  beforeSave: (_c, { action, data, existing }) => { const stock = action === 'create' ? 0 : Number(existing!.data.stock ?? 0); return { ...data, stock, lowStock: data.reorderLevel != null && stock <= Number(data.reorderLevel) }; },
  public: { fields: ['productId', 'sku', 'attributes', 'price', 'stock'], filter: { status: 'active' }, filterable: ['productId'] } };

const PLUS = ['in', 'return', 'adjust_up'];
const stockMovement: EntityDef = { key: 'stockMovement', module: 'inventory', labelEn: 'Stock movement', labelAr: 'حركة مخزون', titleField: '$code', subtitleField: 'type', autoCode: 'SM-', noUpdate: true, noDelete: true, filterable: ['variantId', 'type'],
  fields: { variantId: { type: 'ref', entity: 'variant', required: true }, type: { type: 'enum', values: ['in', 'out', 'return', 'damaged', 'adjust_up', 'adjust_down'], required: true },
    qty: { type: 'int', min: 1, required: true }, reason: { type: 'string' }, orderId: { type: 'ref', entity: 'order' } },
  beforeSave: (ctx, { data }) => {
    const v = ctx.get(String(data.variantId))!; const cur = Number(v.data.stock ?? 0);
    if (!PLUS.includes(String(data.type)) && Number(data.qty) > cur) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${cur} in stock for ${v.data.sku}`);
  },
  afterSave: (ctx, { record }) => {
    const v = ctx.get(String(record.data.variantId))!; const delta = PLUS.includes(String(record.data.type)) ? Number(record.data.qty) : -Number(record.data.qty);
    const stock = Number(v.data.stock ?? 0) + delta; ctx.patch(v.id, { stock, lowStock: v.data.reorderLevel != null && stock <= Number(v.data.reorderLevel) });
  } };

const customer: EntityDef = { key: 'customer', module: 'shopCustomers', labelEn: 'Customer', labelAr: 'عميل', titleField: 'name', subtitleField: '$code', autoCode: 'CU-', searchFields: ['name', 'phone', 'email'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, address: { type: 'string' }, city: { type: 'string' }, notes: { type: 'text' } } };

const coupon: EntityDef = { key: 'coupon', module: 'coupons', labelEn: 'Coupon', labelAr: 'كوبون', titleField: 'code', searchFields: ['code'], filterable: ['active'],
  fields: { code: { type: 'string', required: true, unique: true, max: 40 }, type: { type: 'enum', values: ['percent', 'fixed'], required: true }, value: { type: 'int', min: 1, required: true },
    minOrder: { type: 'money', default: 0 }, maxUses: { type: 'int', min: 1 }, usedCount: { type: 'int', readonly: true }, startsAt: { type: 'date' }, endsAt: { type: 'date' }, active: { type: 'bool', default: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (data.type === 'percent' && Number(data.value) > 100) ctx.fail(400, 'VALIDATION_ERROR', 'percent value cannot exceed 100');
    return { ...data, code: String(data.code).toUpperCase(), usedCount: action === 'create' ? 0 : existing!.data.usedCount };
  } };

type Reader = Pick<HookCtx, 'get' | 'find' | 'fail' | 'now'>;
interface Item { variantId: string; sku: string; name: string; unitPrice: number; unitCost?: number; qty: number; lineTotal: number }
/** Shared by order creation and the public quote: prices are always taken from the catalog, never from the client. */
export function computeOrder(ctx: Reader, input: { lines: { variantId: string; qty: number }[]; couponCode?: unknown; shippingMethodId?: unknown; taxBp?: unknown }) {
  const merged = new Map<string, number>();
  for (const l of input.lines ?? []) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + Number(l.qty));
  if (!merged.size) ctx.fail(400, 'VALIDATION_ERROR', 'lines are required');
  const items: Item[] = [];
  for (const [id, qty] of merged) {
    const v = ctx.get(id); if (!v || v.entityType !== 'variant') ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown variant');
    const p = ctx.get(String(v!.data.productId))!;
    if (v!.data.status !== 'active' || p.data.status !== 'active') ctx.fail(409, 'NOT_AVAILABLE', `${p.data.name} is not available`);
    const unitPrice = Number(v!.data.price ?? p.data.basePrice);
    const attrs = ((v!.data.attributes as { value: string }[] | undefined) ?? []).map((a) => a.value).join(' / ');
    items.push({ variantId: id, sku: String(v!.data.sku), name: attrs ? `${p.data.name} (${attrs})` : String(p.data.name), unitPrice, unitCost: Number(v!.data.cost ?? 0), qty, lineTotal: unitPrice * qty });
  }
  const subtotal = items.reduce((a, i) => a + i.lineTotal, 0);
  let discount = 0; let couponId: string | null = null; let code: string | null = null;
  if (input.couponCode) {
    code = String(input.couponCode).toUpperCase().trim();
    const c = ctx.find('coupon', { code })[0]; const bad = (m: string) => ctx.fail(409, 'COUPON_INVALID', m);
    if (!c || c.data.active === false) bad('Coupon is not valid');
    const today = ctx.now.toISOString().slice(0, 10);
    if (c!.data.startsAt && today < String(c!.data.startsAt)) bad('Coupon is not active yet');
    if (c!.data.endsAt && today > String(c!.data.endsAt)) bad('Coupon has expired');
    if (subtotal < Number(c!.data.minOrder ?? 0)) bad('Order is below the coupon minimum');
    if (c!.data.maxUses && Number(c!.data.usedCount ?? 0) >= Number(c!.data.maxUses)) bad('Coupon usage limit reached');
    discount = c!.data.type === 'percent' ? applyBasisPoints(subtotal, Number(c!.data.value) * 100) : Math.min(Number(c!.data.value), subtotal);
    couponId = c!.id;
  }
  let shippingFee = 0;
  if (input.shippingMethodId) {
    const m = ctx.get(String(input.shippingMethodId)); if (!m || m.entityType !== 'shippingMethod') ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown shipping method');
    shippingFee = m!.data.freeOver != null && subtotal >= Number(m!.data.freeOver) ? 0 : Number(m!.data.fee);
  }
  const tax = applyBasisPoints(subtotal - discount, Number(input.taxBp ?? 0));
  return { items, subtotal, discount, shippingFee, tax, total: subtotal - discount + shippingFee + tax, couponCode: code, couponId };
}

export const ORDER_NEXT: Record<string, string[]> = { pending: ['confirmed', 'cancelled'], confirmed: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [] };
const EDITABLE = ['status', 'paymentStatus', 'trackingNumber', 'carrier', 'notes', 'shipName', 'shipPhone', 'shipAddress', 'shipCity'];
const order: EntityDef = { key: 'order', module: 'orders', labelEn: 'Order', labelAr: 'طلب', titleField: '$code', subtitleField: 'status', autoCode: 'ORD-', searchFields: ['shipName', 'shipPhone'],
  filterable: ['status', 'paymentStatus', 'customerId'], immutableWhen: { field: 'status', values: ['cancelled', 'returned'] }, noDelete: true,
  fields: { customerId: { type: 'ref', entity: 'customer', required: true }, shippingMethodId: { type: 'ref', entity: 'shippingMethod' }, paymentMethodId: { type: 'ref', entity: 'paymentMethod' },
    lines: { type: 'lines', required: true, max: 50, fields: { variantId: { type: 'ref', entity: 'variant', required: true }, qty: { type: 'int', min: 1, required: true } } },
    couponCode: { type: 'string', max: 40 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 },
    shipName: { type: 'string' }, shipPhone: { type: 'phone' }, shipAddress: { type: 'string' }, shipCity: { type: 'string' }, trackingNumber: { type: 'string', max: 60 }, carrier: { type: 'string', max: 60 }, notes: { type: 'text' },
    status: { type: 'enum', values: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'], default: 'pending' },
    paymentStatus: { type: 'enum', values: ['unpaid', 'paid', 'refunded'], default: 'unpaid' },
    items: { type: 'lines', readonly: true, fields: {} }, subtotal: { type: 'money', readonly: true }, discount: { type: 'money', readonly: true }, shippingFee: { type: 'money', readonly: true },
    tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true }, netSales: { type: 'money', readonly: true }, cogs: { type: 'money', readonly: true }, placedAt: { type: 'datetime', readonly: true }, placedDay: { type: 'date', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const c = computeOrder(ctx, data as never);
      return { ...data, status: 'pending', paymentStatus: 'unpaid', items: c.items, subtotal: c.subtotal, discount: c.discount, shippingFee: c.shippingFee, tax: c.tax, total: c.total, couponCode: c.couponCode, netSales: c.subtotal - c.discount, cogs: c.items.reduce((a, i) => a + Number(i.unitCost ?? 0) * i.qty, 0), placedAt: ctx.now.toISOString(), placedDay: ctx.now.toISOString().slice(0, 10) };
    }
    const out: Record<string, unknown> = { ...existing!.data };
    for (const k of EDITABLE) if (k in data) out[k] = data[k];
    const prev = String(existing!.data.status), next = String(out.status);
    if (next !== prev) {
      if (!ORDER_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change order from ${prev} to ${next}`);
      if (next === 'cancelled' && existing!.data.paymentStatus === 'paid') ctx.fail(409, 'REFUND_REQUIRED', 'A paid order must be refunded through a return');
    }
    const pp = String(existing!.data.paymentStatus), pn = String(out.paymentStatus);
    if (pn !== pp && !(pp === 'unpaid' && pn === 'paid')) ctx.fail(409, 'INVALID_TRANSITION', 'Payment status can only change from unpaid to paid (refunds go through returns)');
    return out;
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create') {
      for (const it of record.data.items as Item[]) ctx.createFull('stockMovement', { variantId: it.variantId, type: 'out', qty: it.qty, reason: `order ${record.code}`, orderId: record.id });
      if (record.data.couponCode) { const c = ctx.find('coupon', { code: record.data.couponCode })[0]; if (c) ctx.patch(c.id, { usedCount: Number(c.data.usedCount ?? 0) + 1 }); }
      return;
    }
    if (record.data.status === previous!.data.status) return;
    { // customer e-mail on meaningful status changes (queued in the outbox; "no_provider" when e-mail is not configured)
      const to = ctx.get(String(record.data.customerId))?.data.email;
      if (typeof to === 'string' && to && ['confirmed', 'shipped', 'delivered', 'cancelled'].includes(String(record.data.status)))
        enqueue(ctx.db, ctx.tenantId, 'email', to, 'order_update', { code: record.code, status: record.data.status });
    }
    if (record.data.status === 'confirmed' && !ctx.find('invoice', { orderId: record.id }).length)
      ctx.create('invoice', { orderId: record.id, total: record.data.total, issuedAt: ctx.now.toISOString() });
    if (record.data.status === 'cancelled') { for (const it of record.data.items as Item[]) ctx.createFull('stockMovement', { variantId: it.variantId, type: 'in', qty: it.qty, reason: `cancelled ${record.code}`, orderId: record.id }); ctx.patch(record.id, { netSales: 0, cogs: 0 }); } // a cancelled order no longer counts as sales or cost
  } };

const invoice: EntityDef = { key: 'invoice', module: 'invoices', labelEn: 'Invoice', labelAr: 'فاتورة', titleField: '$code', autoCode: 'INV-', noCreate: true, noUpdate: true, noDelete: true, filterable: ['orderId'],
  fields: { orderId: { type: 'ref', entity: 'order', readonly: true }, total: { type: 'money', readonly: true }, issuedAt: { type: 'datetime', readonly: true } } };

const RET_NEXT: Record<string, string[]> = { requested: ['approved', 'rejected'], approved: ['received'], received: ['refunded', 'exchanged'] };
const sumRefunds = (ctx: HookCtx, orderId: string) => ctx.find('refund', { orderId }).reduce((a, r) => a + Number(r.data.amount), 0);
const returnRequest: EntityDef = { key: 'returnRequest', module: 'returns', labelEn: 'Return request', labelAr: 'طلب مرتجع', titleField: '$code', subtitleField: 'status', autoCode: 'RT-', filterable: ['status', 'orderId'],
  immutableWhen: { field: 'status', values: ['rejected', 'refunded', 'exchanged'] },
  fields: { orderId: { type: 'ref', entity: 'order', required: true }, reason: { type: 'text', required: true },
    lines: { type: 'lines', required: true, max: 50, fields: { variantId: { type: 'ref', entity: 'variant', required: true }, qty: { type: 'int', min: 1, required: true } } },
    kind: { type: 'enum', values: ['return', 'exchange'], default: 'return' }, replacementOrderId: { type: 'ref', entity: 'order' },
    status: { type: 'enum', values: ['requested', 'approved', 'rejected', 'received', 'refunded', 'exchanged'], default: 'requested' }, refundAmount: { type: 'money' } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const o = ctx.get(String(data.orderId))!;
      if (o.data.status !== 'delivered') ctx.fail(409, 'ORDER_NOT_DELIVERED', 'Only delivered orders can be returned');
      const ordered = new Map<string, number>(); for (const i of o.data.items as Item[]) ordered.set(i.variantId, i.qty);
      for (const l of data.lines as { variantId: string; qty: number }[]) if (l.qty > (ordered.get(l.variantId) ?? 0)) ctx.fail(409, 'RETURN_EXCEEDS_ORDER', 'Returned quantity exceeds the ordered quantity');
      return { ...data, status: 'requested', refundAmount: undefined };
    }
    const prev = String(existing!.data.status), next = String(data.status);
    if (next !== prev) {
      if (!RET_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change return from ${prev} to ${next}`);
      if (next === 'exchanged') { // an exchange ends with a replacement order for the same customer, never with money going out
        if (existing!.data.kind !== 'exchange') ctx.fail(409, 'INVALID_TRANSITION', 'Only an exchange request can be completed as exchanged');
        const rep = data.replacementOrderId ? ctx.get(String(data.replacementOrderId)) : undefined; const orig = ctx.get(String(existing!.data.orderId))!;
        if (!rep || rep.entityType !== 'order' || rep.data.customerId !== orig.data.customerId || rep.id === orig.id) ctx.fail(400, 'VALIDATION_ERROR', "replacementOrderId must be another order of the same customer");
        return { ...existing!.data, status: 'exchanged', replacementOrderId: rep!.id };
      }
      if (next === 'refunded') {
        if (existing!.data.kind === 'exchange') ctx.fail(409, 'INVALID_TRANSITION', 'An exchange is not refunded');
        if (data.refundAmount === undefined) ctx.fail(400, 'VALIDATION_ERROR', 'refundAmount is required to refund');
        const o = ctx.get(String(data.orderId))!;
        if (Number(data.refundAmount) > Number(o.data.total) - sumRefunds(ctx, o.id)) ctx.fail(409, 'OVER_REFUND', 'Refund exceeds the amount paid');
      }
    }
    return { ...existing!.data, status: data.status, reason: data.reason, refundAmount: data.refundAmount ?? existing!.data.refundAmount };
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create' || record.data.status === previous!.data.status) return;
    if (record.data.status === 'received') for (const l of record.data.lines as { variantId: string; qty: number }[]) ctx.createFull('stockMovement', { variantId: l.variantId, type: 'return', qty: l.qty, reason: `return ${record.code}`, orderId: String(record.data.orderId) });
    if (record.data.status === 'refunded') {
      ctx.create('refund', { returnId: record.id, orderId: record.data.orderId, amount: record.data.refundAmount });
      const o = ctx.get(String(record.data.orderId))!;
      if (sumRefunds(ctx, o.id) >= Number(o.data.total)) ctx.patch(o.id, { paymentStatus: 'refunded', status: 'returned' });
    }
  } };
const refund: EntityDef = { key: 'refund', module: 'refunds', labelEn: 'Refund', labelAr: 'استرداد', titleField: '$code', autoCode: 'RF-', noCreate: true, noUpdate: true, noDelete: true, filterable: ['orderId'],
  fields: { returnId: { type: 'ref', entity: 'returnRequest', readonly: true }, orderId: { type: 'ref', entity: 'order', readonly: true }, amount: { type: 'money', readonly: true } } };

const tenantTaxBp = (ctx: HookCtx) => ctx.db.select({ t: tenants.taxBp }).from(tenants).where(eq(tenants.id, ctx.tenantId)).get()?.t ?? 0;
const normPhone = (p: unknown) => latinDigits(String(p ?? '')).replace(/[\s\-().]/g, '');
const customerFields = (c: HookCtx, def: EntityDef, input: unknown) => {
  const r = validateData(def, input, { partial: false });
  if (Object.keys(r.errors).length) c.fail(400, 'VALIDATION_ERROR', Object.entries(r.errors).map(([k, v]) => `${k} ${v}`).join('; '));
  return r.data;
};
/** Payment records for an order (cash on delivery, transfer, card...). When they add up to the total the order becomes paid. */
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true, filterable: ['orderId', 'method'],
  fields: { orderId: { type: 'ref', entity: 'order', required: true }, amount: { type: 'money', required: true }, method: { type: 'enum', values: ['cash', 'cod', 'card', 'transfer', 'wallet'], required: true }, reference: { type: 'string', max: 80 } },
  beforeSave: (ctx, { data }) => {
    const o = ctx.get(String(data.orderId))!; if (['cancelled', 'returned'].includes(String(o.data.status)) || o.data.paymentStatus === 'refunded') ctx.fail(409, 'NOT_PAYABLE', 'This order cannot take payments');
    const paid = ctx.find('payment', { orderId: o.id }).reduce((a, x) => a + Number(x.data.amount), 0); const rest = Number(o.data.total) - paid;
    if (Number(data.amount) <= 0) ctx.fail(400, 'VALIDATION_ERROR', 'amount must be positive'); if (Number(data.amount) > rest) ctx.fail(409, 'OVERPAYMENT', `Only ${rest} is outstanding`);
  },
  afterSave: (ctx, { record }) => { const o = ctx.get(String(record.data.orderId))!; const paid = ctx.find('payment', { orderId: o.id }).reduce((a, x) => a + Number(x.data.amount), 0); if (paid >= Number(o.data.total) && o.data.paymentStatus === 'unpaid') ctx.patch(o.id, { paymentStatus: 'paid' }); } };
const policy: EntityDef = { key: 'policy', module: 'policies', labelEn: 'Store policy', labelAr: 'سياسة المتجر', titleField: 'title', searchFields: ['title'], filterable: ['kind', 'active'], defaultSort: { field: 'position', dir: 'asc' },
  fields: { title: { type: 'string', required: true, max: 120 }, kind: { type: 'enum', values: ['shipping', 'returns', 'privacy', 'terms', 'other'], default: 'other' }, body: { type: 'text', required: true }, position: { type: 'int', min: 0, max: 9999, default: 100 }, active: { type: 'bool', default: true } },
  public: { fields: ['title', 'kind', 'body', 'position'], filter: { active: true } } };
const addr = (a: Record<string, unknown> | undefined) => ({ shipName: a?.name, shipPhone: a?.phone, shipAddress: a?.address, shipCity: a?.city });

export const ecommerce: ProductDef = {
  slug: 'ecommerce',
  entities: [category, supplier, shippingMethod, paymentMethod, product, variant, stockMovement, customer, coupon, order, invoice, returnRequest, refund, payment, policy],
  kpis: [
    { key: 'ordersToday', labelEn: 'Orders today', labelAr: 'طلبات اليوم', entity: 'order', agg: 'count', period: 'today', dateField: 'placedAt' },
    { key: 'pendingOrders', labelEn: 'Pending orders', labelAr: 'طلبات معلقة', entity: 'order', agg: 'count', where: { status: 'pending' } },
    { key: 'salesMonth', labelEn: 'Sales this month', labelAr: 'مبيعات الشهر', entity: 'order', agg: 'sum', field: 'total', where: { status: ['confirmed', 'processing', 'shipped', 'delivered'] }, period: 'month', dateField: 'placedAt', money: true },
    { key: 'products', labelEn: 'Products', labelAr: 'المنتجات', entity: 'product', agg: 'count' },
    { key: 'lowStock', labelEn: 'Low-stock variants', labelAr: 'أنواع مخزونها منخفض', entity: 'variant', agg: 'count', where: { lowStock: true } },
    { key: '_netSales', labelEn: '', labelAr: '', entity: 'order', agg: 'sum', field: 'netSales', period: 'month', dateField: 'placedAt', money: true, hidden: true },
    { key: '_cogs', labelEn: '', labelAr: '', entity: 'order', agg: 'sum', field: 'cogs', period: 'month', dateField: 'placedAt', money: true, hidden: true },
    { key: 'cogsMonth', labelEn: 'Cost of goods sold (month)', labelAr: 'تكلفة البضاعة المباعة (الشهر)', entity: 'order', agg: 'sum', money: true, permission: 'refunds.read', derived: { plus: ['_cogs'] } },
    { key: 'grossProfitMonth', labelEn: 'Gross profit (month)', labelAr: 'مجمل الربح (الشهر)', entity: 'order', agg: 'sum', money: true, permission: 'refunds.read', derived: { plus: ['_netSales'], minus: ['_cogs'] } },
    { key: 'outOfStock', labelEn: 'Out of stock variants', labelAr: 'أنواع نفدت', entity: 'variant', agg: 'count', where: { stock: 0 } },
  ],
  reports: [
    { key: 'ordersByStatus', labelEn: 'Orders by status', labelAr: 'الطلبات حسب الحالة', entity: 'order', groupBy: 'status', agg: 'count' },
    { key: 'ordersByPayment', labelEn: 'Orders by payment status', labelAr: 'الطلبات حسب الدفع', entity: 'order', groupBy: 'paymentStatus', agg: 'count' },
    { key: 'salesByDay', labelEn: 'Net sales by day', labelAr: 'صافي المبيعات حسب اليوم', entity: 'order', groupBy: 'placedDay', agg: 'sum', field: 'netSales' },
    { key: 'salesByPaymentMethod', labelEn: 'Sales by payment method', labelAr: 'المبيعات حسب طريقة الدفع', entity: 'order', groupBy: 'paymentMethodId', agg: 'sum', field: 'total' },
  ],
  publicForms: [],
  publicActions: [
    { key: 'quote', method: 'POST', write: false, handler: (ctx, b) => { const { couponId: _c, ...q } = computeOrder(ctx, { ...(b as object), taxBp: tenantTaxBp(ctx) } as never); return q; } },
    { key: 'checkout', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
      const custDef = customer; const c = customerFields(ctx, custDef, b.customer);
      const existing = c.phone ? ctx.find('customer', { phone: normPhone(c.phone) })[0] : undefined;
      const cust = existing ?? ctx.createFull('customer', c);
      const a = (b.address ?? {}) as Record<string, unknown>;
      const o = ctx.createFull('order', { customerId: cust.id, shippingMethodId: b.shippingMethodId, paymentMethodId: b.paymentMethodId, lines: b.lines, couponCode: b.couponCode, taxBp: tenantTaxBp(ctx), ...addr(a) });
      return { orderCode: o.code, total: o.data.total, status: o.data.status };
    } },
    { key: 'track', method: 'GET', write: false, handler: (ctx, q) => {
      const o = ctx.byCode('order', String(q.code ?? '').toUpperCase()); const cust = o && ctx.get(String(o.data.customerId));
      if (!o || !cust || !cust.data.phone || cust.data.phone !== normPhone(q.phone)) ctx.fail(404, 'NOT_FOUND', 'Order not found');
      return { code: o!.code, status: o!.data.status, paymentStatus: o!.data.paymentStatus, trackingNumber: o!.data.trackingNumber ?? null, carrier: o!.data.carrier ?? null, placedAt: o!.data.placedAt, total: o!.data.total,
        items: (o!.data.items as Item[]).map((i) => ({ name: i.name, qty: i.qty, lineTotal: i.lineTotal })) };
    } },
  ],
  employeeModules: { payments: ['read', 'create'], orders: ['read', 'create', 'update'], shopCustomers: ['read', 'create', 'update'], products: ['read'], variants: ['read'], categories: ['read'], inventory: ['read', 'create'],
    shipping: ['read'], paymentMethods: ['read'], returns: ['read', 'create', 'update'], invoices: ['read'] },
};
export type { RecordRow };
