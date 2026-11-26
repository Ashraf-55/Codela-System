import express, { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { files, users, type Db } from '@codela/db';
import { HttpError, notFound } from './errors';
import { assertWritable, getEntitlements } from './entitlements';
import { MAX_UPLOAD_BYTES, validateUpload } from './file-validation';
import { absPath, send, storedBytes } from './uploads';

type FileRow = typeof files.$inferSelect;

/**
 * Validates (magic bytes, size, image only), stores and returns a private avatar file. `ownerId` is the user id (staff) or the portal account id (customers).
 * The previous avatar is removed only after the new one is safely stored, and only if it belongs to the same tenant and owner.
 */
export function saveAvatar(db: Db, uploadDir: string, o: { tenantId: string; ownerId: string; previousFileId: string | null; body: unknown; fileName: string | undefined }): FileRow {
  const buf = Buffer.isBuffer(o.body) ? o.body : Buffer.alloc(0);
  let name = 'avatar'; try { name = decodeURIComponent(o.fileName ?? 'avatar'); } catch { /* keep default */ }
  const v = validateUpload('avatar', buf, name); if (!v.ok) throw new HttpError(v.status, v.code, v.message);
  const limitMb = getEntitlements(db, o.tenantId).limits.storageMb;
  if (typeof limitMb === 'number' && storedBytes(db, o.tenantId) + buf.length > limitMb * 1024 * 1024) throw new HttpError(403, 'PLAN_LIMIT_EXCEEDED', `Storage limit reached (${limitMb} MB).`);
  const key = `${randomBytes(16).toString('hex')}.${v.detected.ext}`;
  mkdirSync(path.join(uploadDir, o.tenantId), { recursive: true });
  const target = absPath(uploadDir, o.tenantId, key); writeFileSync(target, buf, { flag: 'wx', mode: 0o640 });
  let row: FileRow;
  try { row = db.insert(files).values({ tenantId: o.tenantId, ownerUserId: o.ownerId, purpose: 'avatar', originalName: v.safeName, mime: v.detected.mime, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), storageKey: key, visibility: 'private' }).returning().get(); }
  catch (e) { rmSync(target, { force: true }); throw e; } // never leave orphan bytes behind
  if (o.previousFileId) removeAvatar(db, uploadDir, o.tenantId, o.ownerId, o.previousFileId);
  return row;
}

export function removeAvatar(db: Db, uploadDir: string, tenantId: string, ownerId: string, fileId: string | null): void {
  if (!fileId) return;
  const f = db.select().from(files).where(and(eq(files.id, fileId), eq(files.tenantId, tenantId), eq(files.ownerUserId, ownerId), eq(files.purpose, 'avatar'))).get(); if (!f) return;
  db.delete(files).where(eq(files.id, f.id)).run(); rmSync(absPath(uploadDir, f.tenantId, f.storageKey), { force: true });
}

export function avatarFile(db: Db, tenantId: string, ownerId: string, fileId: string | null): FileRow {
  const f = fileId ? db.select().from(files).where(and(eq(files.id, fileId), eq(files.tenantId, tenantId), eq(files.ownerUserId, ownerId), eq(files.purpose, 'avatar'))).get() : undefined;
  if (!f) throw notFound('No profile picture');
  return f;
}

/** Staff / owner profile picture. Mounted on the authenticated router: GET/PUT/DELETE /auth/me/avatar (own picture only). */
export function staffAvatarRouter(db: Db, uploadDir: string) {
  const r = Router(); const raw = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });
  const me = (userId: string) => db.select({ id: users.id, avatarFileId: users.avatarFileId }).from(users).where(eq(users.id, userId)).get()!;
  r.get('/auth/me/avatar', (req, res, next) => {
    try { const a = req.auth!; const f = avatarFile(db, a.tenantId, a.userId, me(a.userId).avatarFileId); send(res, absPath(uploadDir, f.tenantId, f.storageKey), f, 'inline', 'private, no-store'); } catch (e) { next(e); }
  });
  r.put('/auth/me/avatar', raw, (req, res, next) => {
    try {
      const a = req.auth!; assertWritable(db, a.tenantId);
      const f = saveAvatar(db, uploadDir, { tenantId: a.tenantId, ownerId: a.userId, previousFileId: me(a.userId).avatarFileId, body: req.body, fileName: req.get('x-file-name') });
      db.update(users).set({ avatarFileId: f.id }).where(eq(users.id, a.userId)).run();
      res.json({ data: { url: '/api/v1/auth/me/avatar', version: f.id } });
    } catch (e) { next(e); }
  });
  r.delete('/auth/me/avatar', (req, res, next) => {
    try { const a = req.auth!; removeAvatar(db, uploadDir, a.tenantId, a.userId, me(a.userId).avatarFileId); db.update(users).set({ avatarFileId: null }).where(eq(users.id, a.userId)).run(); res.json({ data: { ok: true } }); } catch (e) { next(e); }
  });
  return r;
}
