import { and, count, eq, inArray, like, or, sql, asc } from 'drizzle-orm';
import { searchIndex, type Db } from '@codela/db';
import { hasPermission } from '@codela/shared';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩', PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** Lowercase, Arabic/Persian digits -> latin, strip tashkeel & tatweel, collapse whitespace. */
export function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ').trim();
}
const escapeLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface IndexEntry { entityType: string; entityId: string; title: string; subtitle?: string | null; terms: (string | null | undefined)[]; permissionKey: string }

export function indexEntity(db: Db, tenantId: string, e: IndexEntry) {
  const keywords = normalize([e.title, ...e.terms].filter(Boolean).join(' '));
  db.insert(searchIndex).values({ tenantId, entityType: e.entityType, entityId: e.entityId, title: e.title,
    subtitle: e.subtitle ?? null, keywords, permissionKey: e.permissionKey })
    .onConflictDoUpdate({ target: [searchIndex.tenantId, searchIndex.entityType, searchIndex.entityId],
      set: { title: e.title, subtitle: e.subtitle ?? null, keywords, permissionKey: e.permissionKey, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` } }).run();
}
export function removeFromIndex(db: Db, tenantId: string, entityType: string, entityId: string) {
  db.delete(searchIndex).where(and(eq(searchIndex.tenantId, tenantId), eq(searchIndex.entityType, entityType), eq(searchIndex.entityId, entityId))).run();
}

export interface SearchParams { q: string; page: number; pageSize: number; entityType?: string }
export function search(db: Db, tenantId: string, permissions: string[], p: SearchParams) {
  const keys = db.selectDistinct({ k: searchIndex.permissionKey }).from(searchIndex).where(eq(searchIndex.tenantId, tenantId)).all().map((r) => r.k);
  const allowed = keys.filter((k) => hasPermission(permissions, k));
  const q = normalize(p.q);
  const tokens = q.split(' ').filter(Boolean);
  const textMatch = and(...tokens.map((t) => like(searchIndex.keywords, `%${escapeLike(t)}%`).append(sql` ESCAPE '\\'`)));
  const where = and(
    eq(searchIndex.tenantId, tenantId), // tenant isolation: always injected
    inArray(searchIndex.permissionKey, allowed.length ? [...allowed] : ['__none__']),
    p.entityType ? eq(searchIndex.entityType, p.entityType) : undefined,
    or(textMatch, eq(searchIndex.entityId, p.q.trim())),
  );
  const total = db.select({ c: count() }).from(searchIndex).where(where).get()!.c;
  const rows = db.select({ entityType: searchIndex.entityType, entityId: searchIndex.entityId, title: searchIndex.title, subtitle: searchIndex.subtitle })
    .from(searchIndex).where(where).orderBy(asc(searchIndex.title)).limit(p.pageSize).offset((p.page - 1) * p.pageSize).all();
  return { rows, total };
}
