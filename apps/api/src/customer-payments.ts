import express, { Router, type RequestHandler } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, count, eq, isNull } from 'drizzle-orm';
import { auditLogs, files, type Db } from '@codela/db';
import { HttpError, badRequest, notFound } from './errors';
import { assertWritable } from './entitlements';
import { requirePermission } from './auth';
import { detectFile } from './file-validation';
import { absPath, send } from './uploads';
import { productOf } from './products/routes';
import { getRecord } from './products/store';
import { PAYABLE } from './products/customer-payments';

const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_UNATTACHED_PER_TENANT = 30; // receipts uploaded but never submitted: bounds abuse of the public upload

/** Public: a customer uploads the receipt of a transfer BEFORE submitting the payment request (which references the returned id). Host decides the tenant. */
export function customerPaymentPublicRouter(db: Db, o: { uploadDir: string; limiter: RequestHandler; resolveTenant: (host: string) => { id: string } | undefined }) {
  const r = Router();
  r.put('/customer-payment/receipt', o.limiter, express.raw({ type: () => true, limit: RECEIPT_MAX_BYTES }), (req, res, next) => {
    let target: string | undefined;
    try {
      const t = o.resolveTenant(req.hostname.toLowerCase()); if (!t) throw notFound('Site not found');
      assertWritable(db, t.id);
      if (!PAYABLE[productOf(db, t.id).slug]) throw notFound('Not available');
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); if (buf.length === 0) throw badRequest('A receipt file is required');
      let name = 'receipt'; try { name = decodeURIComponent(String(req.get('x-file-name') ?? 'receipt')); } catch { /* keep default */ }
      const d = detectFile(buf, name); if (!d || !(d.kind === 'image' || d.mime === 'application/pdf')) throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'The receipt must be a PNG, JPG, WEBP or PDF file');
      const open = db.select({ n: count() }).from(files).where(and(eq(files.tenantId, t.id), eq(files.purpose, 'receipt'), isNull(files.entityId))).get()?.n ?? 0;
      if (open >= MAX_UNATTACHED_PER_TENANT) throw new HttpError(429, 'TOO_MANY_UPLOADS', 'Too many receipts are waiting to be attached; try again later');
      const key = `${randomBytes(16).toString('hex')}.${d.ext}`; mkdirSync(path.join(o.uploadDir, t.id), { recursive: true });
      target = absPath(o.uploadDir, t.id, key); writeFileSync(target, buf, { flag: 'wx', mode: 0o640 });
      const f = db.insert(files).values({ tenantId: t.id, ownerUserId: null, purpose: 'receipt', originalName: name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'receipt', mime: d.mime, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), storageKey: key, visibility: 'private' }).returning().get();
      res.status(201).json({ data: { receiptId: f.id } });
    } catch (e) { if (target) rmSync(target, { force: true }); next(e); }
  });
  return r;
}

/** Staff: view the receipt of a payment request of THEIR tenant (needs payments.read; every view is audited; never reachable through the generic file routes). */
export function customerPaymentTenantRouter(db: Db, o: { uploadDir: string }) {
  const r = Router();
  r.get('/tenant/customer-payments/:id/receipt', requirePermission('payments.read'), (req, res, next) => {
    try {
      const a = req.auth!; const rec = getRecord(db, a.tenantId, String(req.params.id));
      if (!rec || rec.entityType !== 'paymentRequest' || !rec.data.receiptFileId) throw notFound('Receipt not found');
      const f = db.select().from(files).where(and(eq(files.id, String(rec.data.receiptFileId)), eq(files.tenantId, a.tenantId), eq(files.purpose, 'receipt'))).get(); if (!f) throw notFound('Receipt not found');
      db.insert(auditLogs).values({ action: 'customer_payment.receipt_viewed', tenantId: a.tenantId, actorId: a.userId, entity: 'paymentRequest', entityId: rec.id }).run();
      send(res, absPath(o.uploadDir, a.tenantId, f.storageKey), f, 'inline', 'private, no-store');
    } catch (e) { next(e); }
  });
  return r;
}
