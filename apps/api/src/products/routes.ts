import { Router, type Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, tenants, type Db } from '@codela/db';
import { hasPermission } from '@codela/shared';
import { HttpError, forbidden, notFound } from '../errors';
import { assertWithinLimit, assertWritable } from '../entitlements';
import { requirePermission } from '../auth';
import { getProduct } from './registry';
import type { EntityDef, ProductDef } from './framework';
import { createRecord, deleteRecord, makeHookCtx, getRecord, kpiValue, listRecords, publicCatalog, publicRow, reportGroups, updateRecord } from './store';

export const productOf = (db: Db, tenantId: string): ProductDef => {
  const t = db.select({ p: tenants.productSlug }).from(tenants).where(eq(tenants.id, tenantId)).get();
  const p = t && getProduct(t.p);
  if (!p) throw notFound('This product has no management modules yet');
  return p;
};
const entityOf = (p: ProductDef, key: string): EntityDef => p.entities.find((e) => e.key === key) ?? (() => { throw notFound('Unknown entity'); })();
const need = (req: Request, def: EntityDef, action: 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export') => {
  if (!hasPermission(req.auth!.permissions, `${def.module}.${action}`)) throw forbidden();
};
const EXPORT_MAX = 20_000;
/** CSV cell: quoted, and neutralised against spreadsheet formula injection (=, +, -, @, tab, CR at the start). */
export const csvCell = (v: unknown): string => { let t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
const listParams = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(), sort: z.string().max(40).optional(), dir: z.enum(['asc', 'desc']).optional() }).passthrough();

/** Product tenant routes (mounted under /tenant, already authenticated + subscription-guarded). */
export function productTenantRouter(db: Db) {
  const r = Router();
  const ctx = (req: Request, p: ProductDef) => ({ db, tenantId: req.auth!.tenantId, userId: req.auth!.userId, product: p });

  r.get('/p-meta', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId);
      const entities = p.entities.filter((e) => hasPermission(req.auth!.permissions, `${e.module}.read`)).map((e) => ({
        key: e.key, module: e.module, labelEn: e.labelEn, labelAr: e.labelAr, titleField: e.titleField, filterable: e.filterable ?? [], noDelete: !!e.noDelete, noUpdate: !!e.noUpdate,
        autoCode: !!e.autoCode, canCreate: hasPermission(req.auth!.permissions, `${e.module}.create`), canUpdate: hasPermission(req.auth!.permissions, `${e.module}.update`), canDelete: hasPermission(req.auth!.permissions, `${e.module}.delete`), canApprove: hasPermission(req.auth!.permissions, `${e.module}.approve`), canExport: hasPermission(req.auth!.permissions, `${e.module}.export`),
        fields: Object.fromEntries(Object.entries(e.fields).map(([k, f]) => [k, { type: f.type, required: !!f.required, readonly: !!f.readonly, values: f.values, entity: f.entity, default: f.default, fields: f.fields }])) }));
      res.json({ data: { product: p.slug, entities } });
    } catch (e) { next(e); }
  });

  r.get('/dashboard', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const kpis: Record<string, number> = {}; const labels: Record<string, { en: string; ar: string; money: boolean }> = {};
      const byKey = new Map(p.kpis.map((x) => [x.key, x] as const));
      const val = (k: (typeof p.kpis)[number]): number => (k.derived ? (k.derived.plus ?? []).reduce((a, x) => a + val(byKey.get(x)!), 0) - (k.derived.minus ?? []).reduce((a, x) => a + val(byKey.get(x)!), 0) : kpiValue(db, req.auth!.tenantId, k));
      for (const k of p.kpis) {
        if (k.hidden) continue; // building blocks of derived KPIs
        const def = entityOf(p, k.entity);
        if (!hasPermission(req.auth!.permissions, k.permission ?? `${def.module}.read`)) continue;
        kpis[k.key] = val(k); labels[k.key] = { en: k.labelEn, ar: k.labelAr, money: !!k.money };
      }
      const reports = p.reports.filter((x) => hasPermission(req.auth!.permissions, `${entityOf(p, x.entity).module}.read`)).map((x) => ({ key: x.key, labelEn: x.labelEn, labelAr: x.labelAr, money: x.agg === 'sum', groupRef: ((f) => (f?.type === 'ref' ? f.entity ?? null : null))(entityOf(p, x.entity).fields[x.groupBy]) }));
      res.json({ data: { kpis, labels, reports } });
    } catch (e) { next(e); }
  });
  r.get('/reports/:key', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const rep = p.reports.find((x) => x.key === req.params.key);
      if (!rep) throw notFound('Unknown report');
      need(req, entityOf(p, rep.entity), 'read');
      res.json({ data: reportGroups(db, req.auth!.tenantId, rep) });
    } catch (e) { next(e); }
  });

  r.get('/p/:entity', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const def = entityOf(p, String(req.params.entity)); need(req, def, 'read');
      const q = listParams.parse(req.query);
      const params = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      const { rows, total } = listRecords(db, req.auth!.tenantId, def, { q: q.q, page: q.page, pageSize: q.pageSize, sort: q.sort, dir: q.dir, params });
      res.json({ data: rows.map(publicRow), meta: { total, page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });
  /** Business: stock per warehouse (product x warehouse), computed from the movement ledger. */
  r.get('/stock-balances', (req, res, next) => {
    try {
      const t = req.auth!.tenantId; const p = productOf(db, t); if (p.slug !== 'business') throw notFound('Not available for this product');
      const mv = entityOf(p, 'stockMovement'); need(req, mv, 'read'); const PLUS = ['in', 'adjust_up', 'transfer_in', 'return']; // the same sign rule the stock ledger itself uses (transfers are ledger rows too)
      const all = (def: EntityDef) => { const out: ReturnType<typeof publicRow>[] = []; for (let page = 1; page <= 500; page++) { const x = listRecords(db, t, def, { page, pageSize: 100, params: {} }); out.push(...x.rows.map(publicRow)); if (x.rows.length < 100) break; } return out; };
      const whs = all(entityOf(p, 'warehouse')).map((w) => ({ id: w.id, name: String((w as any).data.name) })); const prods = new Map(all(entityOf(p, 'product')).map((x) => [x.id, x as any]));
      const bal = new Map<string, Record<string, number>>(); for (const m of all(mv) as any[]) { const row = bal.get(m.data.productId) ?? {}; row[m.data.warehouseId] = (row[m.data.warehouseId] ?? 0) + (PLUS.includes(String(m.data.type)) ? 1 : -1) * Number(m.data.qty); bal.set(m.data.productId, row); }
      const rows = [...bal.entries()].map(([productId, byWarehouse]) => { const pr = prods.get(productId); return { productId, name: pr?.data.name ?? productId, sku: pr?.data.sku ?? '', reorderLevel: pr?.data.reorderLevel ?? null, byWarehouse, total: Object.values(byWarehouse).reduce((a, b) => a + b, 0) }; }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      res.json({ data: { warehouses: whs, rows } });
    } catch (e) { next(e); }
  });
  /** CSV export of one list: needs `<module>.export`, is tenant-scoped through the same query as the list, capped, and always audited. */
  r.get('/p/:entity/export.csv', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const def = entityOf(p, String(req.params.entity)); need(req, def, 'read'); need(req, def, 'export');
      const params = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined; const rows: ReturnType<typeof publicRow>[] = [];
      for (let page = 1; rows.length < EXPORT_MAX; page++) { const r2 = listRecords(db, req.auth!.tenantId, def, { q, page, pageSize: 100, params }); rows.push(...r2.rows.map(publicRow)); if (r2.rows.length < 100) break; }
      const cols = ['code', ...Object.entries(def.fields).filter(([, f]) => f.type !== 'lines').map(([k]) => k)]; const out = rows.slice(0, EXPORT_MAX);
      const body = '\uFEFF' + [cols, ...out.map((row) => cols.map((c) => (c === 'code' ? (row as any).code : (row as any).data?.[c])))].map((l) => l.map(csvCell).join(',')).join('\r\n');
      db.insert(auditLogs).values({ action: 'record.export', tenantId: req.auth!.tenantId, actorId: req.auth!.userId, entity: def.key, meta: { rows: out.length } }).run();
      res.setHeader('content-type', 'text/csv; charset=utf-8'); res.setHeader('content-disposition', `attachment; filename="${def.key}.csv"`); res.setHeader('cache-control', 'no-store'); res.send(body);
    } catch (e) { next(e); }
  });
  r.get('/p/:entity/:id', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const def = entityOf(p, String(req.params.entity)); need(req, def, 'read');
      const rec = getRecord(db, req.auth!.tenantId, String(req.params.id));
      if (!rec || rec.entityType !== def.key) throw notFound(`${def.labelEn} not found`);
      if (def.sensitive) db.insert(auditLogs).values({ action: 'record.read', tenantId: req.auth!.tenantId, actorId: req.auth!.userId, entity: def.key, entityId: rec.id }).run();
      res.json({ data: publicRow(rec) });
    } catch (e) { next(e); }
  });
  r.post('/p/:entity', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const def = entityOf(p, String(req.params.entity)); need(req, def, 'create');
      assertWithinLimit(db, req.auth!.tenantId, 'maxRecords');
      res.status(201).json({ data: publicRow(createRecord(ctx(req, p), def, req.body)) });
    } catch (e) { next(e); }
  });
  r.patch('/p/:entity/:id', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const def = entityOf(p, String(req.params.entity)); need(req, def, 'update');
      if (def.approvals && typeof req.body?.[def.approvals.field] === 'string' && def.approvals.values.includes(req.body[def.approvals.field])) need(req, def, 'approve');
      res.json({ data: publicRow(updateRecord(ctx(req, p), def, String(req.params.id), req.body)) });
    } catch (e) { next(e); }
  });
  r.delete('/p/:entity/:id', (req, res, next) => {
    try {
      const p = productOf(db, req.auth!.tenantId); const def = entityOf(p, String(req.params.entity)); need(req, def, 'delete');
      deleteRecord(ctx(req, p), def, String(req.params.id)); res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  return r;
}

/** Public website data + forms; tenant is resolved from the Host header only (verified domain or subdomain). */
export function productPublicRouter(db: Db, resolveTenant: (host: string) => { id: string } | undefined, formLimiter: import('express').RequestHandler, afterWrite: (tenantId: string) => Promise<void> = async () => {}) {
  const r = Router();
  const tenantOf = (req: Request) => { const t = resolveTenant(req.hostname.toLowerCase()); if (!t) throw notFound('Site not found'); return t.id; };
  r.get('/site-meta', (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const p = productOf(db, tenantId);
      const spec = (def: EntityDef, keys: string[]) => Object.fromEntries(keys.filter((k) => def.fields[k]).map((k) => [k, { type: def.fields[k].type, required: !!def.fields[k].required, values: def.fields[k].values, entity: def.fields[k].entity }]));
      res.json({ data: { productSlug: p.slug,
        catalogs: p.entities.filter((e) => e.public).map((e) => ({ entity: e.key, labelEn: e.labelEn, labelAr: e.labelAr, titleField: e.titleField, filterable: e.public!.filterable ?? [], fields: e.public!.fields.filter((f) => e.fields[f]).map((f) => ({ key: f, type: e.fields[f].type })) })),
        forms: p.publicForms.map((f) => { const def = entityOf(p, f.entity); return { key: f.key, labelEn: def.labelEn, labelAr: def.labelAr, fields: spec(def, f.fields) }; }),
        actions: (p.publicActions ?? []).map((a) => ({ key: a.key, method: a.method })) } });
    } catch (e) { next(e); }
  });
  r.get('/catalog/:entity', (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const p = productOf(db, tenantId); const def = entityOf(p, String(req.params.entity));
      if (!def.public) throw notFound('Unknown catalog');
      const params = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      const page = Math.max(1, Number(params.page) || 1); const pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 24));
      const out = publicCatalog(db, tenantId, def, params, page, pageSize);
      res.json({ data: out.rows, meta: { total: out.total, page, pageSize } });
    } catch (e) { next(e); }
  });
  r.post('/forms/:key', formLimiter, (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const p = productOf(db, tenantId); const form = p.publicForms.find((f) => f.key === req.params.key);
      if (!form) throw notFound('Unknown form');
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      if (typeof body.website === 'string' && body.website) return void res.status(201).json({ data: { ok: true } }); // honeypot
      assertWritable(db, tenantId); assertWithinLimit(db, tenantId, 'maxRecords');
      const def = entityOf(p, form.entity);
      createRecord({ db, tenantId, userId: null, product: p }, def, { ...form.defaults, ...Object.fromEntries(form.fields.filter((f) => f in body).map((f) => [f, body[f]])) });
      res.status(201).json({ data: { ok: true } });
    } catch (e) { next(e instanceof HttpError && e.status === 402 ? new HttpError(503, 'UNAVAILABLE', 'This business is not accepting requests right now') : e); }
  });
  r.all('/actions/:key', formLimiter, async (req, res, next) => {
    try {
      const tenantId = tenantOf(req); const p = productOf(db, tenantId);
      const a = p.publicActions?.find((x) => x.key === req.params.key && x.method === req.method);
      if (!a) throw notFound('Unknown action');
      const input = (req.method === 'GET' ? req.query : req.body) as Record<string, unknown>;
      if (a.write) {
        if (typeof input?.website === 'string' && input.website) return void res.status(201).json({ data: { ok: true } });
        assertWritable(db, tenantId); assertWithinLimit(db, tenantId, 'maxRecords');
      }
      const out = db.transaction((tx) => a.handler(makeHookCtx({ db, tenantId, userId: null, product: p }, tx as unknown as Db), input ?? {}));
      if (a.write) await afterWrite(tenantId).catch(() => {}); // deliver queued messages after the data is committed
      res.status(a.status ?? 200).json({ data: out });
    } catch (e) { next(e instanceof HttpError && e.status === 402 ? new HttpError(503, 'UNAVAILABLE', 'This business is not accepting requests right now') : e); }
  });
  return r;
}
export { requirePermission, and };
