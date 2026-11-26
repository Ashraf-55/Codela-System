import express, { type Request, type Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { files, memberships, roles, rolePermissions, users, type Db } from '@codela/db';
import { z } from 'zod';
import { HttpError, badRequest, conflict, notFound } from './errors';
import { assertWritable } from './entitlements';
import { requirePermission } from './auth';
import { detectFile } from './file-validation';
import { absPath, send } from './uploads';
import { productOf } from './products/routes';
import { getRecord, listRecords, makeHookCtx, updateRecord } from './products/store';

/**
 * Driver portal API (fleet). A driver is a normal login whose role has ONLY the `driver.use` permission, so no generic dashboard/API module is reachable;
 * every route here resolves the driver record from the session and only ever touches shipments assigned to THAT driver.
 * Delivery rules stay in the shipment hooks (transitions, COD collection booked on delivery); this layer adds ownership, proof of delivery and cash reconciliation.
 */
export interface FleetDriverDeps { uploadDir: string; hashPassword: (p: string) => Promise<string>; assertWithinLimit: (db: Db, tenantId: string, key: 'maxEmployees') => void; audit: (action: string, tenantId: string, actorId: string, entity: string, id: string) => void; isUnique: (e: unknown) => boolean }
const DRIVER_TARGETS = ['picked_up', 'out_for_delivery', 'delivered', 'failed_attempt'] as const;
const TERMINAL = ['delivered', 'returned', 'cancelled'];
const PROOF_MAX = 5 * 1024 * 1024;
const statusBody = z.object({ status: z.enum(DRIVER_TARGETS), reason: z.string().trim().min(3).max(300).optional(), recipientName: z.string().trim().min(2).max(120).optional(), note: z.string().trim().max(500).optional(), collected: z.number().int().min(0).optional(),
  // optional GPS point of the driver at the moment of the update (sent only when the driver allowed location access)
  lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }).refine((v) => (v.lat === undefined) === (v.lng === undefined), 'lat and lng go together');
const accountBody = z.object({ driverId: z.string().min(1).max(64), email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().min(1).max(120).optional(), password: z.string().min(10).max(200) });

export function fleetDriverRoutes(r: Router, db: Db, d: FleetDriverDeps) {
  const fleetOnly = (tenantId: string) => { const p = productOf(db, tenantId); if (p.slug !== 'fleet') throw notFound('Not available'); return p; };
  function driverOf(req: Request) {
    const a = req.auth!; const p = fleetOnly(a.tenantId); const def = (k: string) => p.entities.find((e) => e.key === k)!;
    const drv = listRecords(db, a.tenantId, def('driver'), { forced: { userId: a.userId }, page: 1, pageSize: 1, params: {} }).rows[0];
    if (!drv || drv.data.active === false) throw new HttpError(403, 'NO_DRIVER_PROFILE', 'This account is not linked to an active driver');
    return { a, p, def, drv, ctx: { db, tenantId: a.tenantId, userId: a.userId, product: p } };
  }
  const own = (x: ReturnType<typeof driverOf>, id: string) => { const s = getRecord(db, x.a.tenantId, id); if (!s || s.entityType !== 'shipment' || s.data.driverId !== x.drv.id) throw notFound('Shipment not found'); return s; };
  const view = (s: { id: string; code?: string | null; data: Record<string, unknown>; createdAt: string }) => ({ id: s.id, code: s.code, status: s.data.status, recipientName: s.data.recipientName, recipientPhone: s.data.recipientPhone, recipientAddress: s.data.recipientAddress, recipientCity: s.data.recipientCity,
    description: s.data.description ?? '', notes: s.data.notes ?? '', codAmount: Number(s.data.codAmount ?? 0), attempts: Number(s.data.attempts ?? 0), failureReason: s.data.failureReason ?? '', deliveredAt: s.data.deliveredAt ?? null, proofName: s.data.proofName ?? '', hasProof: !!s.data.proofFileId, collectedAmount: s.data.collectedAmount ?? null, createdAt: s.createdAt });

  r.get('/tenant/driver/me', requirePermission('driver.use'), (req, res, next) => {
    try { const x = driverOf(req); const all = listRecords(db, x.a.tenantId, x.def('shipment'), { forced: { driverId: x.drv.id }, page: 1, pageSize: 500, params: {} }).rows;
      res.json({ data: { id: x.drv.id, name: x.drv.data.name, phone: x.drv.data.phone ?? '', active: all.filter((s) => !TERMINAL.includes(String(s.data.status))).length, delivered: all.filter((s) => s.data.status === 'delivered').length, cashPending: all.filter((s) => s.data.status === 'delivered').reduce((n, s) => n + Number(s.data.codAmount ?? 0), 0) } }); } catch (e) { next(e); }
  });
  r.get('/tenant/driver/shipments', requirePermission('driver.use'), (req, res, next) => {
    try {
      const x = driverOf(req); const scope = req.query.scope === 'history' ? 'history' : 'active';
      const rows = listRecords(db, x.a.tenantId, x.def('shipment'), { forced: { driverId: x.drv.id }, page: 1, pageSize: 500, sort: 'createdAt', dir: 'desc', params: {} }).rows.filter((s) => (scope === 'history') === TERMINAL.includes(String(s.data.status)));
      res.json({ data: rows.slice(0, 100).map(view) });
    } catch (e) { next(e); }
  });
  r.post('/tenant/driver/shipments/:id/status', requirePermission('driver.use'), (req, res, next) => {
    try {
      const x = driverOf(req); assertWritable(db, x.a.tenantId); const b = statusBody.parse(req.body); const s = own(x, String(req.params.id));
      if (b.status === 'failed_attempt' && !b.reason) throw badRequest('A reason is required for a failed delivery');
      if (b.status === 'delivered') {
        if (!b.recipientName) throw badRequest('Enter the name of the person who received the shipment');
        const cod = Number(s.data.codAmount ?? 0); if ((b.collected ?? 0) !== cod) throw new HttpError(409, 'COD_MISMATCH', cod > 0 ? `Collect exactly the COD amount (${cod}); report any difference to the dispatcher instead of delivering` : 'This shipment has no cash to collect');
      }
      const sdef = x.def('shipment'); const upd = updateRecord(x.ctx, sdef, s.id, { status: b.status, ...(b.status === 'failed_attempt' ? { failureReason: b.reason } : {}) });
      if (b.lat !== undefined && b.lng !== undefined) makeHookCtx(x.ctx, db).patch(s.id, { lastLocation: `${b.lat.toFixed(5)},${b.lng.toFixed(5)}`, lastLocationAt: new Date().toISOString() });
      if (b.status === 'delivered') makeHookCtx(x.ctx, db).patch(s.id, { proofName: b.recipientName, proofNote: b.note || undefined, collectedAmount: b.collected ?? 0 });
      res.json({ data: view(getRecord(db, x.a.tenantId, upd.id)!) });
    } catch (e) { next(e); }
  });
  r.put('/tenant/driver/shipments/:id/proof', requirePermission('driver.use'), express.raw({ type: () => true, limit: PROOF_MAX }), (req, res, next) => {
    let target: string | undefined;
    try {
      const x = driverOf(req); assertWritable(db, x.a.tenantId); const s = own(x, String(req.params.id));
      if (!['out_for_delivery', 'delivered', 'failed_attempt'].includes(String(s.data.status))) throw new HttpError(409, 'NOT_OUT_FOR_DELIVERY', 'Proof can be added once the shipment is out for delivery');
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); if (!buf.length) throw badRequest('A photo is required');
      const det = detectFile(buf, 'proof'); if (!det || det.kind !== 'image') throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'The proof must be a PNG, JPG or WEBP photo');
      const key = `${randomBytes(16).toString('hex')}.${det.ext}`; mkdirSync(path.join(d.uploadDir, x.a.tenantId), { recursive: true }); target = absPath(d.uploadDir, x.a.tenantId, key); writeFileSync(target, buf, { flag: 'wx', mode: 0o640 });
      const f = db.insert(files).values({ tenantId: x.a.tenantId, ownerUserId: x.a.userId, purpose: 'proof', originalName: 'proof', mime: det.mime, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), storageKey: key, visibility: 'private', entityType: 'shipment', entityId: s.id }).returning().get();
      const old = s.data.proofFileId ? db.select().from(files).where(and(eq(files.id, String(s.data.proofFileId)), eq(files.tenantId, x.a.tenantId), eq(files.purpose, 'proof'))).get() : undefined;
      makeHookCtx(x.ctx, db).patch(s.id, { proofFileId: f.id });
      if (old) { db.delete(files).where(eq(files.id, old.id)).run(); rmSync(absPath(d.uploadDir, x.a.tenantId, old.storageKey), { force: true }); }
      res.status(201).json({ data: { ok: true } });
    } catch (e) { if (target) rmSync(target, { force: true }); next(e); }
  });

  // ---- staff side: review the proof photo, and create driver logins ----
  r.get('/tenant/fleet/shipments/:id/proof', requirePermission('shipments.read'), (req, res, next) => {
    try {
      const a = req.auth!; fleetOnly(a.tenantId); const s = getRecord(db, a.tenantId, String(req.params.id)); if (!s || s.entityType !== 'shipment' || !s.data.proofFileId) throw notFound('Proof not found');
      const f = db.select().from(files).where(and(eq(files.id, String(s.data.proofFileId)), eq(files.tenantId, a.tenantId), eq(files.purpose, 'proof'))).get(); if (!f) throw notFound('Proof not found');
      d.audit('shipment.proof_viewed', a.tenantId, a.userId, 'shipment', s.id); send(res, absPath(d.uploadDir, a.tenantId, f.storageKey), f, 'inline', 'private, no-store');
    } catch (e) { next(e); }
  });
  r.post('/tenant/fleet/driver-accounts', requirePermission('employees.manage'), async (req, res, next) => {
    try {
      const a = req.auth!; const p = fleetOnly(a.tenantId); const b = accountBody.parse(req.body);
      const drv = getRecord(db, a.tenantId, b.driverId); if (!drv || drv.entityType !== 'driver') throw notFound('Driver not found');
      if (drv.data.userId) throw conflict('This driver already has a login');
      d.assertWithinLimit(db, a.tenantId, 'maxEmployees'); const hash = await d.hashPassword(b.password);
      const user = db.transaction((tx) => {
        let role = tx.select().from(roles).where(and(eq(roles.tenantId, a.tenantId), eq(roles.name, 'driver'))).get();
        if (!role) { role = tx.insert(roles).values({ tenantId: a.tenantId, name: 'driver', isSystem: true }).returning().get(); tx.insert(rolePermissions).values({ roleId: role.id, permission: 'driver.use' }).run(); }
        const u = tx.insert(users).values({ email: b.email, passwordHash: hash, name: b.name ?? String(drv.data.name) }).returning().get();
        tx.insert(memberships).values({ userId: u.id, tenantId: a.tenantId, roleId: role.id }).run(); return u;
      });
      makeHookCtx({ db, tenantId: a.tenantId, userId: a.userId, product: p }, db).patch(drv.id, { userId: user.id });
      d.audit('driver.account_created', a.tenantId, a.userId, 'user', user.id);
      res.status(201).json({ data: { userId: user.id, email: user.email, driverId: drv.id } });
    } catch (e) { next(d.isUnique(e) ? conflict('Email already registered') : e); }
  });
}
