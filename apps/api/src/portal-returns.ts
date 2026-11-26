import type { Request, RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Db } from '@codela/db';
import { HttpError, notFound } from './errors';
import { assertWritable } from './entitlements';
import { productOf } from './products/routes';
import { createRecord, getRecord, listRecords } from './products/store';

/**
 * The returns side of the e-commerce customer portal. A customer can only ask to return lines of THEIR OWN delivered orders
 * (matched through the account e-mail, like `/portal/my`). The request is created through the SAME `returnRequest` hooks the dashboard uses
 * (delivered only, quantity <= ordered), so approval, restocking and refunds stay with the merchant. Refund amounts are never writable here.
 */
export interface ReturnsDeps { auth: RequestHandler; who: (req: Request) => { tenantId: string; email: string } }
const body = z.object({ orderId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(1000), lines: z.array(z.object({ variantId: z.string().min(1).max(64), qty: z.number().int().min(1).max(999) })).min(1).max(50) });
const OPEN = ['requested', 'approved', 'received'];

export function returnsPortalRoutes(r: Router, db: Db, d: ReturnsDeps) {
  const page = { page: 1, pageSize: 200, params: {} as Record<string, string> };
  function mine(req: Request) {
    const { tenantId, email } = d.who(req); const product = productOf(db, tenantId);
    if (product.slug !== 'ecommerce') throw notFound('Not available');
    const def = (k: string) => product.entities.find((e) => e.key === k)!;
    const customer = listRecords(db, tenantId, def('customer'), { forced: { email }, ...page, pageSize: 1 }).rows[0];
    if (!customer) throw notFound('No customer record for this account');
    return { tenantId, product, def, customer, ctx: { db, tenantId, userId: null, product } };
  }

  r.get('/portal/returns', d.auth, (req, res, next) => {
    try {
      const m = mine(req);
      const orders = listRecords(db, m.tenantId, m.def('order'), { forced: { customerId: m.customer.id }, ...page }).rows;
      const out = orders.flatMap((o) => listRecords(db, m.tenantId, m.def('returnRequest'), { forced: { orderId: o.id }, ...page }).rows
        .map((x) => ({ id: x.id, code: x.code, orderCode: o.code, status: x.data.status, reason: x.data.reason, createdAt: x.createdAt })));
      res.json({ data: out });
    } catch (e) { next(e); }
  });

  r.post('/portal/returns', d.auth, (req, res, next) => {
    try {
      const m = mine(req); assertWritable(db, m.tenantId); const b = body.parse(req.body);
      const order = getRecord(db, m.tenantId, b.orderId);
      if (!order || order.entityType !== 'order' || order.data.customerId !== m.customer.id) throw notFound('Order not found'); // someone else's order is indistinguishable from a missing one
      const existing = listRecords(db, m.tenantId, m.def('returnRequest'), { forced: { orderId: order.id }, ...page }).rows;
      if (existing.some((x) => OPEN.includes(String(x.data.status)))) throw new HttpError(409, 'RETURN_ALREADY_OPEN', 'A return request for this order is already in progress');
      const rec = createRecord(m.ctx, m.def('returnRequest'), { orderId: order.id, reason: b.reason, lines: b.lines });
      res.status(201).json({ data: { id: rec.id, code: rec.code, status: rec.data.status } });
    } catch (e) { next(e); }
  });
}
