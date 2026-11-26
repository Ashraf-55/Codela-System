import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { auditLogs, records, type Db } from '@codela/db';
import { HttpError } from '../errors';
import { indexEntity, normalize, removeFromIndex } from '../search';
import { validateData, type EntityDef, type FieldDef, type HookCtx, type ProductDef, type RecordRow } from './framework';

const jf = (field: string) => sql`json_extract(${records.data}, ${'$.' + field})`;
const esc = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
const toRow = (r: typeof records.$inferSelect): RecordRow => ({ id: r.id, tenantId: r.tenantId, entityType: r.entityType, code: r.code, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });
export const publicRow = (r: RecordRow) => ({ id: r.id, entityType: r.entityType, code: r.code, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });

export interface Ctx { db: Db; tenantId: string; userId: string | null; product: ProductDef }
const defOf = (product: ProductDef, key: string) => product.entities.find((e) => e.key === key);
const isUnique = (e: unknown) => /UNIQUE constraint failed/.test(String((e as Error)?.message));

export function getRecord(db: Db, tenantId: string, id: string): RecordRow | undefined {
  const r = db.select().from(records).where(and(eq(records.id, id), eq(records.tenantId, tenantId))).get();
  return r && toRow(r);
}
export function countRecords(db: Db, tenantId: string): number {
  return db.select({ c: count() }).from(records).where(eq(records.tenantId, tenantId)).get()!.c;
}
function nextCode(db: Db, tenantId: string, entity: string, prefix: string): string {
  const row = db.get(sql`insert into counters (tenant_id, key, value) values (${tenantId}, ${entity}, 1)
    on conflict (tenant_id, key) do update set value = value + 1 returning value`) as { value: number };
  return `${prefix}${String(row.value).padStart(4, '0')}`;
}
const eqValue = (f: FieldDef | undefined, v: unknown) => (f?.type === 'bool' ? (v === true || v === 'true' ? 1 : 0) : f?.type === 'int' || f?.type === 'money' ? Number(v) : v);

function findWhere(db: Db, tenantId: string, entity: string, where: Record<string, unknown> = {}): RecordRow[] {
  const conds: SQL[] = [eq(records.tenantId, tenantId), eq(records.entityType, entity)];
  for (const [k, v] of Object.entries(where)) conds.push(sql`${jf(k)} = ${typeof v === 'boolean' ? (v ? 1 : 0) : v}`);
  return db.select().from(records).where(and(...conds)).all().map(toRow);
}

export function makeHookCtx(c: Ctx, db: Db): HookCtx { return hookCtx(c, db); }
function hookCtx(c: Ctx, db: Db): HookCtx {
  const self: HookCtx = {
    db, tenantId: c.tenantId, userId: c.userId ?? '', now: new Date(),
    get: (id) => getRecord(db, c.tenantId, id),
    find: (entity, where) => findWhere(db, c.tenantId, entity, where),
    create: (entity, data) => insertRow(c, db, defOf(c.product, entity)!, data),
    createFull: (entity, input) => createRecord({ ...c, db }, defOf(c.product, entity)!, input, { system: true }),
    byCode: (entity, code) => { const r = db.select().from(records).where(and(eq(records.tenantId, c.tenantId), eq(records.entityType, entity), eq(records.code, code))).get(); return r && toRow(r); },
    patch: (id, data) => {
      const cur = getRecord(db, c.tenantId, id)!; const def = defOf(c.product, cur.entityType)!;
      const merged = { ...cur.data, ...data };
      db.update(records).set({ data: merged, updatedAt: new Date().toISOString() }).where(and(eq(records.id, id), eq(records.tenantId, c.tenantId))).run();
      const next = getRecord(db, c.tenantId, id)!; reindex(db, c.tenantId, def, next); return next;
    },
    fail: (status, code, message) => { throw new HttpError(status, code, message); },
  };
  return self;
}

function reindex(db: Db, tenantId: string, def: EntityDef, r: RecordRow) {
  const val = (f: string) => (f === '$code' ? r.code : r.data[f]);
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  indexEntity(db, tenantId, { entityType: def.key, entityId: r.id, title: str(val(def.titleField)) ?? r.code ?? r.id,
    subtitle: def.subtitleField ? str(val(def.subtitleField)) : r.code,
    terms: [r.code, r.id, ...(def.searchFields ?? []).map((f) => str(r.data[f]))], permissionKey: `${def.module}.read` });
}

function checkRefs(db: Db, tenantId: string, def: EntityDef, data: Record<string, unknown>) {
  for (const [name, f] of Object.entries(def.fields)) {
    if (f.type === 'lines' && Array.isArray(data[name])) {
      for (const row of data[name] as Record<string, unknown>[]) for (const [sk, sf] of Object.entries(f.fields ?? {})) {
        if (sf.type !== 'ref' || typeof row[sk] !== 'string') continue;
        const t = getRecord(db, tenantId, row[sk] as string);
        if (!t || t.entityType !== sf.entity) throw new HttpError(400, 'REFERENCE_NOT_FOUND', `${name}.${sk} does not reference an existing ${sf.entity}`);
      }
      continue;
    }
    if (f.type !== 'ref' || typeof data[name] !== 'string') continue;
    const target = getRecord(db, tenantId, data[name] as string);
    if (!target || target.entityType !== f.entity) throw new HttpError(400, 'REFERENCE_NOT_FOUND', `${name} does not reference an existing ${f.entity}`);
  }
}
const uniqueKeyOf = (def: EntityDef, data: Record<string, unknown>) => {
  const parts = Object.entries(def.fields).filter(([, f]) => f.unique).map(([k]) => String(data[k] ?? '').toLowerCase().trim());
  return parts.length ? parts.join('|') : null;
};
const validationError = (errors: Record<string, string>) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Invalid input', Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]])));
const clean = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined));

function insertRow(c: Ctx, db: Db, def: EntityDef, data: Record<string, unknown>): RecordRow {
  const row = db.insert(records).values({ tenantId: c.tenantId, entityType: def.key, data, createdBy: c.userId,
    code: def.autoCode ? nextCode(db, c.tenantId, def.key, def.autoCode) : null, uniqueKey: uniqueKeyOf(def, data) }).returning().get();
  const r = toRow(row); reindex(db, c.tenantId, def, r); return r;
}

export function createRecord(c: Ctx, def: EntityDef, input: unknown, opts: { system?: boolean } = {}): RecordRow {
  if (def.noCreate && !opts.system) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${def.labelEn} records are created automatically`);
  const { data, errors } = validateData(def, input, { partial: false });
  if (Object.keys(errors).length) throw validationError(errors);
  try {
    return c.db.transaction((tx) => {
      const db = tx as unknown as Db;
      checkRefs(db, c.tenantId, def, data);
      const ctx = hookCtx(c, db);
      const finalData = clean(def.beforeSave?.(ctx, { action: 'create', data }) ?? data);
      const rec = insertRow(c, db, def, finalData);
      def.afterSave?.(ctx, { action: 'create', record: rec });
      db.insert(auditLogs).values({ action: 'record.created', tenantId: c.tenantId, actorId: c.userId, entity: def.key, entityId: rec.id }).run();
      return getRecord(db, c.tenantId, rec.id)!;
    });
  } catch (e) { throw isUnique(e) ? new HttpError(409, 'CONFLICT', `${def.labelEn} already exists`) : e; }
}

export function updateRecord(c: Ctx, def: EntityDef, id: string, input: unknown): RecordRow {
  if (def.noUpdate) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${def.labelEn} records cannot be edited`);
  const { data, errors } = validateData(def, input, { partial: true });
  if (Object.keys(errors).length) throw validationError(errors);
  if (!Object.keys(data).length) throw new HttpError(400, 'VALIDATION_ERROR', 'No editable fields provided');
  try {
    return c.db.transaction((tx) => {
      const db = tx as unknown as Db;
      const existing = getRecord(db, c.tenantId, id);
      if (!existing || existing.entityType !== def.key) throw new HttpError(404, 'NOT_FOUND', `${def.labelEn} not found`);
      if (def.immutableWhen && def.immutableWhen.values.includes(String(existing.data[def.immutableWhen.field])))
        throw new HttpError(409, 'IMMUTABLE', `This ${def.labelEn.toLowerCase()} is ${existing.data[def.immutableWhen.field]} and can no longer be changed`);
      checkRefs(db, c.tenantId, def, data);
      const merged = clean({ ...existing.data, ...data, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v === null)) });
      const ctx = hookCtx(c, db);
      const finalData = clean(def.beforeSave?.(ctx, { action: 'update', data: merged, existing }) ?? merged);
      db.update(records).set({ data: finalData, uniqueKey: uniqueKeyOf(def, finalData), updatedAt: new Date().toISOString() })
        .where(and(eq(records.id, id), eq(records.tenantId, c.tenantId))).run();
      const rec = getRecord(db, c.tenantId, id)!; reindex(db, c.tenantId, def, rec);
      def.afterSave?.(ctx, { action: 'update', record: rec, previous: existing });
      db.insert(auditLogs).values({ action: 'record.updated', tenantId: c.tenantId, actorId: c.userId, entity: def.key, entityId: id }).run();
      return getRecord(db, c.tenantId, id)!;
    });
  } catch (e) { throw isUnique(e) ? new HttpError(409, 'CONFLICT', `${def.labelEn} already exists`) : e; }
}

export function deleteRecord(c: Ctx, def: EntityDef, id: string): void {
  if (def.noDelete) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${def.labelEn} records cannot be deleted`);
  c.db.transaction((tx) => {
    const db = tx as unknown as Db;
    const existing = getRecord(db, c.tenantId, id);
    if (!existing || existing.entityType !== def.key) throw new HttpError(404, 'NOT_FOUND', `${def.labelEn} not found`);
    if (def.immutableWhen && def.immutableWhen.values.includes(String(existing.data[def.immutableWhen.field]))) throw new HttpError(409, 'IMMUTABLE', `This ${def.labelEn.toLowerCase()} can no longer be deleted`);
    for (const other of c.product.entities) for (const [name, f] of Object.entries(other.fields)) {
      if (f.type === 'lines') {
        for (const [sk, sf] of Object.entries(f.fields ?? {})) {
          if (sf.type !== 'ref' || sf.entity !== def.key) continue;
          const n = (db.get(sql`select count(*) as c from ${records} where ${records.tenantId} = ${c.tenantId} and ${records.entityType} = ${other.key}
            and exists (select 1 from json_each(json_extract(${records.data}, ${'$.' + name})) where json_extract(value, ${'$.' + sk}) = ${id})`) as { c: number }).c;
          if (n > 0) throw new HttpError(409, 'IN_USE', `Cannot delete: referenced by ${n} ${other.labelEn} record(s)`);
        }
        continue;
      }
      if (f.type !== 'ref' || f.entity !== def.key) continue;
      const n = db.select({ c: count() }).from(records).where(and(eq(records.tenantId, c.tenantId), eq(records.entityType, other.key), sql`${jf(name)} = ${id}`)).get()!.c;
      if (n > 0) throw new HttpError(409, 'IN_USE', `Cannot delete: referenced by ${n} ${other.labelEn} record(s)`);
    }
    def.beforeDelete?.(hookCtx(c, db), existing);
    db.delete(records).where(and(eq(records.id, id), eq(records.tenantId, c.tenantId))).run();
    removeFromIndex(db, c.tenantId, def.key, id);
    db.insert(auditLogs).values({ action: 'record.deleted', tenantId: c.tenantId, actorId: c.userId, entity: def.key, entityId: id }).run();
  });
}

export interface ListQuery { forced?: Record<string, unknown>; allowedFilters?: string[]; q?: string; page: number; pageSize: number; sort?: string; dir?: 'asc' | 'desc'; params: Record<string, string> }
export function listRecords(db: Db, tenantId: string, def: EntityDef, q: ListQuery) {
  const conds: SQL[] = [eq(records.tenantId, tenantId), eq(records.entityType, def.key)];
  for (const [k, v] of Object.entries(q.forced ?? {})) conds.push(sql`${jf(k)} = ${eqValue(def.fields[k], v)}`);
  for (const f of (q.allowedFilters ?? def.filterable ?? [])) {
    const fd = def.fields[f];
    if (q.params[f] !== undefined) conds.push(sql`${jf(f)} = ${eqValue(fd, q.params[f])}`);
    if (q.params[`${f}_from`] !== undefined) conds.push(sql`${jf(f)} >= ${eqValue(fd, q.params[`${f}_from`])}`);
    if (q.params[`${f}_to`] !== undefined) conds.push(sql`${jf(f)} <= ${eqValue(fd, q.params[`${f}_to`])}`);
  }
  for (const tok of normalize(q.q ?? '').split(' ').filter(Boolean)) {
    const pat = `%${esc(tok)}%`;
    const parts = [sql`lower(coalesce(${records.code}, '')) like ${pat} escape '\\'`, ...(def.searchFields ?? []).map((f) => sql`lower(coalesce(${jf(f)}, '')) like ${pat} escape '\\'`)];
    conds.push(sql`(${sql.join(parts, sql` or `)})`);
  }
  const where = and(...conds);
  const sortField = q.sort ?? def.defaultSort?.field ?? 'createdAt'; const dir = q.dir ?? def.defaultSort?.dir ?? 'desc';
  const col = sortField === 'createdAt' ? records.createdAt : sortField === 'updatedAt' ? records.updatedAt : sortField === 'code' ? records.code : null;
  if (!col && !(sortField in def.fields && def.fields[sortField].type !== 'lines')) throw new HttpError(400, 'BAD_REQUEST', `Cannot sort by ${sortField}`);
  const order = col ? (dir === 'asc' ? asc(col) : desc(col)) : (dir === 'asc' ? sql`${jf(sortField)} asc` : sql`${jf(sortField)} desc`);
  const total = db.select({ c: count() }).from(records).where(where).get()!.c;
  const rows = db.select().from(records).where(where).orderBy(order, asc(records.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all().map(toRow);
  return { rows, total };
}

export function kpiValue(db: Db, tenantId: string, k: import('./framework').KpiDef, now = new Date()): number {
  const conds: SQL[] = [eq(records.tenantId, tenantId), eq(records.entityType, k.entity)];
  for (const [f, v] of Object.entries(k.where ?? {})) {
    if (Array.isArray(v)) conds.push(sql`${jf(f)} in (${sql.join(v.map((x) => sql`${x}`), sql`, `)})`);
    else conds.push(sql`${jf(f)} = ${typeof v === 'boolean' ? (v ? 1 : 0) : v}`);
  }
  if (k.period) {
    const iso = now.toISOString(); const prefix = k.period === 'today' ? iso.slice(0, 10) : iso.slice(0, 7);
    conds.push(sql`${jf(k.dateField ?? 'date')} like ${prefix + '%'}`);
  }
  const expr = k.agg === 'count' ? sql`count(*)` : k.minusField ? sql`coalesce(sum(${jf(k.field!)} - coalesce(${jf(k.minusField)}, 0)), 0)` : sql`coalesce(sum(${jf(k.field!)}), 0)`;
  return (db.get(sql`select ${expr} as v from ${records} where ${and(...conds)}`) as { v: number }).v;
}
export function reportGroups(db: Db, tenantId: string, r: import('./framework').ReportDef) {
  const expr = r.agg === 'count' ? sql`count(*)` : sql`coalesce(sum(${jf(r.field!)}), 0)`;
  const extra = Object.entries(r.where ?? {}).map(([f, v]) => sql` and ${jf(f)} = ${typeof v === 'boolean' ? (v ? 1 : 0) : v}`);
  return (db.all(sql`select ${jf(r.groupBy)} as k, ${expr} as v from ${records} where ${records.tenantId} = ${tenantId} and ${records.entityType} = ${r.entity}${sql.join(extra, sql``)} group by k order by v desc`) as { k: unknown; v: number }[])
    .map((x) => ({ key: x.k === null ? 'unspecified' : String(x.k), value: x.v }));
}
export function publicCatalog(db: Db, tenantId: string, def: EntityDef, params: Record<string, string>, page: number, pageSize: number) {
  const pub = def.public!; const sort = params.sort && pub.fields.includes(params.sort) ? params.sort : pub.fields.includes(def.titleField) ? def.titleField : 'createdAt';
  const { rows, total } = listRecords(db, tenantId, def, { q: params.q, page, pageSize, sort, dir: params.dir === 'desc' ? 'desc' : 'asc',
    forced: pub.filter, allowedFilters: pub.filterable ?? [], params });
  return { rows: rows.map((r) => ({ id: r.id, ...Object.fromEntries(pub.fields.filter((f) => r.data[f] !== undefined).map((f) => [f, r.data[f]])) })), total };
}
