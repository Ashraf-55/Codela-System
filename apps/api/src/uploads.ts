import express, { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import { files, auditLogs, records, type Db } from '@codela/db';
import { HttpError, badRequest, notFound } from './errors';
import { assertWritable, getEntitlements } from './entitlements';
import { requirePermission } from './auth';
import { MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, PURPOSES, RULES, detectVideoHead, validateUpload, sanitizeName, type Purpose } from './file-validation';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, statSync } from 'node:fs';
import { hasPermission } from '@codela/shared';
import { productOf } from './products/routes';

/** Which permission may upload each purpose (staff side). Reading a private file needs customers.read; logos need tenant.settings. */
const UPLOAD_PERMISSION: Record<Purpose, string> = { logo: 'tenant.settings', site: 'tenant.settings', avatar: 'customers.update', product: 'customers.update', document: 'customers.update', medical: 'customers.update', education: 'customers.update', video: 'customers.update' };
const SAFE_KEY = /^[a-f0-9]{32}\.(png|jpg|gif|webp|pdf|docx|xlsx|pptx|txt|csv|mp4|webm)$/;

/** Attachments inherit the access rules of the record they belong to (e.g. a front-desk user who cannot read medical records cannot read their attachments). */
const entityAllows = (db: Db, perms: string[], tenantId: string, entityType: string | null, action: 'read' | 'update'): boolean => {
  if (!entityType) return true;
  const def = productOf(db, tenantId).entities.find((e) => e.key === entityType); if (!def) return false;
  return hasPermission(perms, `${def.module}.${action}`);
};

export const storedBytes = (db: Db, tenantId: string) => (db.get(sql`select coalesce(sum(size),0) as n from files where tenant_id = ${tenantId}`) as { n: number }).n;

/** Streams a stored file with headers that stop the browser from ever executing it as a page. */
export function send(res: express.Response, abs: string, f: typeof files.$inferSelect, disposition: 'inline' | 'attachment', cache: string) {
  if (!existsSync(abs)) throw notFound('File content is missing');
  res.setHeader('content-type', f.mime); res.setHeader('content-length', String(f.size));
  res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('content-security-policy', "default-src 'none'; sandbox"); res.setHeader('cross-origin-resource-policy', 'same-site');
  res.setHeader('cache-control', cache); res.setHeader('accept-ranges', 'bytes');
  const asciiName = f.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('content-disposition', `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(f.originalName)}`);
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(res.req?.headers.range ?? '')); // single byte range: lets <video> seek and resume
  if (m && (m[1] || m[2]) && f.mime.startsWith('video/')) {
    const size = f.size; const start = m[1] ? Number(m[1]) : size - Number(m[2]); let end = m[1] && m[2] ? Number(m[2]) : size - 1; if (!m[1]) end = size - 1;
    if (!(start >= 0 && start < size) || end < start) { res.status(416); res.setHeader('content-range', `bytes */${size}`); res.setHeader('content-length', '0'); res.end(); return; }
    end = Math.min(end, size - 1); res.status(206); res.setHeader('content-range', `bytes ${start}-${end}/${size}`); res.setHeader('content-length', String(end - start + 1));
    createReadStream(abs, { start, end }).pipe(res); return;
  }
  createReadStream(abs).pipe(res);
}

/** Absolute path of a stored object; the key shape is re-checked so a corrupted row can never escape the upload directory. */
export function absPath(uploadDir: string, tenantId: string, key: string): string { if (!SAFE_KEY.test(key)) throw new HttpError(500, 'INTERNAL', 'Invalid storage key'); return path.join(uploadDir, tenantId, key); }

export function filesRouters(db: Db, opts: { uploadDir: string }) {
  const authed = Router(); const pub = Router();
  const abs = (tenantId: string, key: string) => { if (!SAFE_KEY.test(key)) throw new HttpError(500, 'INTERNAL', 'Invalid storage key'); return path.join(opts.uploadDir, tenantId, key); };
  const view = (f: typeof files.$inferSelect) => ({ entityType: f.entityType, entityId: f.entityId, id: f.id, purpose: f.purpose, name: f.originalName, mime: f.mime, size: f.size, visibility: f.visibility, createdAt: f.createdAt, url: f.visibility === 'public' ? `/api/v1/public/files/${f.id}` : `/api/v1/tenant/files/${f.id}` });

  /** Hosted lesson videos: streamed to disk (never held in memory), content-sniffed from the first bytes, size-capped, tied to one lesson of the caller's own tenant. */
  authed.post('/tenant/files/video', async (req, res, next) => {
    let target = '';
    try {
      const a = req.auth!; const entityId = String(req.query.entityId ?? '');
      if (!entityAllows(db, a.permissions, a.tenantId, 'lesson', 'update')) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      assertWritable(db, a.tenantId);
      const lesson = db.select({ id: records.id }).from(records).where(and(eq(records.id, entityId), eq(records.entityType, 'lesson'), eq(records.tenantId, a.tenantId))).get(); if (!lesson) throw notFound('Lesson not found'); // never attach to another tenant
      const declared = Number(req.get('content-length') ?? NaN); if (!Number.isFinite(declared) || declared <= 0) throw new HttpError(411, 'LENGTH_REQUIRED', 'Content-Length is required');
      if (declared > MAX_VIDEO_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', `Video exceeds the ${Math.floor(MAX_VIDEO_BYTES / 1048576)} MB limit`);
      const limitMb = getEntitlements(db, a.tenantId).limits.storageMb;
      if (typeof limitMb === 'number' && storedBytes(db, a.tenantId) + declared > limitMb * 1024 * 1024) throw new HttpError(403, 'PLAN_LIMIT_EXCEEDED', `Storage limit reached (${limitMb} MB). Delete files, upgrade your plan or add storage.`);
      let name = 'video'; try { name = decodeURIComponent(String(req.get('x-file-name') ?? 'video')); } catch { /* keep default */ }
      const dir = path.join(opts.uploadDir, a.tenantId); mkdirSync(dir, { recursive: true });
      const hash = createHash('sha256'); let size = 0; let head = Buffer.alloc(0); let detected: ReturnType<typeof detectVideoHead> = null; let key = '';
      const gate = new Transform({ transform(chunk: Buffer, _enc, cb) {
        size += chunk.length; if (size > MAX_VIDEO_BYTES || size > declared) return cb(new HttpError(413, 'FILE_TOO_LARGE', 'Video exceeds the allowed size'));
        if (!detected) { head = Buffer.concat([head, chunk]).subarray(0, 64); if (head.length < 12) { hash.update(chunk); return cb(null, chunk); } detected = detectVideoHead(head); if (!detected) return cb(new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'Only MP4 and WebM videos are allowed')); }
        hash.update(chunk); cb(null, chunk);
      } });
      // the file name needs the detected extension, which is known only after the first chunk: write to a temp key, then rename
      const tmpKey = `${randomBytes(16).toString('hex')}.mp4`; target = abs(a.tenantId, tmpKey);
      await pipeline(req, gate, createWriteStream(target, { flags: 'wx', mode: 0o640 }));
      if (!detected || size === 0) throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'Only MP4 and WebM videos are allowed');
      key = `${randomBytes(16).toString('hex')}.${(detected as { ext: string }).ext}`; const finalPath = abs(a.tenantId, key); const { renameSync } = await import('node:fs'); renameSync(target, finalPath); target = finalPath;
      let row: typeof files.$inferSelect;
      try { row = db.insert(files).values({ tenantId: a.tenantId, ownerUserId: a.userId, purpose: 'video', originalName: sanitizeName(name, (detected as { ext: string }).ext), mime: (detected as { mime: string }).mime, size: statSync(finalPath).size, sha256: hash.digest('hex'), storageKey: key, visibility: 'private', entityType: 'lesson', entityId }).returning().get(); }
      catch (e) { rmSync(finalPath, { force: true }); throw e; }
      db.insert(auditLogs).values({ action: 'file.uploaded', tenantId: a.tenantId, actorId: a.userId, entity: 'file', entityId: row.id }).run();
      res.status(201).json({ data: view(row) });
    } catch (e) { if (target) rmSync(target, { force: true }); next(e); } // never leave a partial / rejected upload on disk
  });


  authed.post('/tenant/files', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), (req, res, next) => {
    try {
      const a = req.auth!; const purpose = String(req.query.purpose ?? '');
      if (!(PURPOSES as readonly string[]).includes(purpose)) throw badRequest('Unknown upload purpose');
      if (!hasPermission(a.permissions, UPLOAD_PERMISSION[purpose as Purpose])) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      if (purpose === 'video') throw badRequest('Videos are uploaded through /tenant/files/video');
      assertWritable(db, a.tenantId);
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      let name = 'file'; try { name = decodeURIComponent(String(req.get('x-file-name') ?? 'file')); } catch { /* keep default */ }
      const v = validateUpload(purpose, buf, name); if (!v.ok) throw new HttpError(v.status, v.code, v.message);
      const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : null; const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : null;
      if ((entityType === null) !== (entityId === null)) throw badRequest('entityType and entityId go together');
      if (entityType && !entityAllows(db, a.permissions, a.tenantId, entityType, 'update')) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      if (entityId !== null && !db.select({ id: records.id }).from(records).where(and(eq(records.id, entityId), eq(records.entityType, entityType!), eq(records.tenantId, a.tenantId))).get()) throw notFound('Record not found'); // never attach to another tenant's record
      const limitMb = getEntitlements(db, a.tenantId).limits.storageMb;
      if (typeof limitMb === 'number' && storedBytes(db, a.tenantId) + buf.length > limitMb * 1024 * 1024) throw new HttpError(403, 'PLAN_LIMIT_EXCEEDED', `Storage limit reached (${limitMb} MB). Delete files, upgrade your plan or add storage.`);
      const key = `${randomBytes(16).toString('hex')}.${v.detected.ext}`;
      const dir = path.join(opts.uploadDir, a.tenantId); mkdirSync(dir, { recursive: true });
      const target = abs(a.tenantId, key); writeFileSync(target, buf, { flag: 'wx', mode: 0o640 });
      let row: typeof files.$inferSelect;
      try { row = db.insert(files).values({ tenantId: a.tenantId, ownerUserId: a.userId, purpose, originalName: v.safeName, mime: v.detected.mime, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), storageKey: key, visibility: RULES[purpose as Purpose].visibility, entityType, entityId }).returning().get(); }
      catch (e) { rmSync(target, { force: true }); throw e; } // never leave orphan bytes behind
      db.insert(auditLogs).values({ action: 'file.uploaded', tenantId: a.tenantId, actorId: a.userId, entity: 'file', entityId: row.id }).run();
      res.status(201).json({ data: view(row) });
    } catch (e) { next(e); }
  });

  authed.get('/tenant/files', requirePermission('customers.read'), (req, res) => {
    const purpose = typeof req.query.purpose === 'string' ? req.query.purpose : null; const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : null;
    const where = and(eq(files.tenantId, req.auth!.tenantId), sql`${files.purpose} not in ('receipt', 'proof')`, purpose ? eq(files.purpose, purpose) : undefined, entityId ? eq(files.entityId, entityId) : undefined);
    const rows = db.select().from(files).where(where).orderBy(desc(files.createdAt)).limit(200).all();
    const a = req.auth!; const ok = new Map<string, boolean>(); const can = (t: string | null) => { const k = t ?? ''; if (!ok.has(k)) ok.set(k, entityAllows(db, a.permissions, a.tenantId, t, 'read')); return ok.get(k)!; };
    res.json({ data: rows.filter((f) => can(f.entityType)).map(view), meta: { usedBytes: storedBytes(db, req.auth!.tenantId) } });
  });

  // Private download: tenant-scoped lookup, so another tenant's id is indistinguishable from a missing one (404).
  authed.get('/tenant/files/:id', requirePermission('customers.read'), (req, res, next) => {
    try {
      const f = db.select().from(files).where(and(eq(files.id, String(req.params.id)), eq(files.tenantId, req.auth!.tenantId))).get(); if (!f || ['receipt', 'proof'].includes(f.purpose)) throw notFound('File not found'); // payment receipts / delivery proofs are served only by their own routes
      if (!entityAllows(db, req.auth!.permissions, f.tenantId, f.entityType, 'read')) throw notFound('File not found');
      if (f.purpose === 'medical') db.insert(auditLogs).values({ action: 'file.read.medical', tenantId: req.auth!.tenantId, actorId: req.auth!.userId, entity: 'file', entityId: f.id }).run();
      send(res, abs(f.tenantId, f.storageKey), f, f.mime.startsWith('image/') ? 'inline' : 'attachment', 'private, no-store');
    } catch (e) { next(e); }
  });

  authed.delete('/tenant/files/:id', requirePermission('customers.update'), (req, res, next) => {
    try {
      const a = req.auth!; const f = db.select().from(files).where(and(eq(files.id, String(req.params.id)), eq(files.tenantId, a.tenantId))).get(); if (!f || ['receipt', 'proof'].includes(f.purpose)) throw notFound('File not found');
      if (['logo', 'site'].includes(f.purpose) && !hasPermission(a.permissions, 'tenant.settings')) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      if (!entityAllows(db, a.permissions, a.tenantId, f.entityType, 'update')) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
      assertWritable(db, a.tenantId);
      db.delete(files).where(eq(files.id, f.id)).run(); rmSync(abs(f.tenantId, f.storageKey), { force: true });
      db.insert(auditLogs).values({ action: 'file.deleted', tenantId: a.tenantId, actorId: a.userId, entity: 'file', entityId: f.id }).run();
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  // Public (logos, product images ONLY: visibility is fixed by purpose at upload time and re-checked here). Ids are random UUIDs.
  pub.get('/files/:id', (req, res, next) => {
    try {
      const f = db.select().from(files).where(eq(files.id, String(req.params.id))).get();
      if (!f || f.visibility !== 'public' || !f.mime.startsWith('image/')) throw notFound('File not found');
      send(res, abs(f.tenantId, f.storageKey), f, 'inline', 'public, max-age=3600');
    } catch (e) { next(e); }
  });
  return { authed, pub };
}
