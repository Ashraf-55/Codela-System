import type { Db } from '@codela/db';
import { tenants as tenantsTable } from '@codela/db';
import { eq as eqOp } from 'drizzle-orm';

export type FieldType = 'string' | 'text' | 'email' | 'phone' | 'url' | 'date' | 'time' | 'datetime' | 'int' | 'money' | 'bool' | 'enum' | 'ref' | 'lines';
export interface FieldDef {
  type: FieldType; required?: boolean; readonly?: boolean; default?: unknown;
  max?: number; min?: number; values?: readonly string[]; entity?: string; // enum values / ref target
  fields?: Record<string, FieldDef>; // for lines
  unique?: boolean; sensitive?: boolean;
}
export interface RecordRow { id: string; tenantId: string; entityType: string; code: string | null; data: Record<string, unknown>; createdAt: string; updatedAt: string }

export interface HookCtx {
  db: Db; tenantId: string; userId: string; now: Date;
  get(id: string): RecordRow | undefined;
  find(entity: string, where?: Record<string, unknown>): RecordRow[];
  create(entity: string, data: Record<string, unknown>): RecordRow;           // trusted insert, no validation/hooks
  createFull(entity: string, input: Record<string, unknown>): RecordRow;     // full validation + hooks (nested transaction)
  byCode(entity: string, code: string): RecordRow | undefined;
  patch(id: string, data: Record<string, unknown>): RecordRow;
  fail(status: number, code: string, message: string): never;
}
export interface EntityDef {
  key: string; module: string; labelEn: string; labelAr: string;
  titleField: string; /* data field name or '$code' */ subtitleField?: string;
  fields: Record<string, FieldDef>;
  autoCode?: string;                    // e.g. 'PT-' => PT-0001 per tenant
  searchFields?: string[];              // fields included in global + module search
  filterable?: string[]; sortable?: string[]; defaultSort?: { field: string; dir: 'asc' | 'desc' };
  immutableWhen?: { field: string; values: string[] }; noDelete?: boolean; noUpdate?: boolean; noCreate?: boolean; /* system-created only */
  sensitive?: boolean;                  // reads of single records are audit-logged
  /** Moving `field` to one of `values` is an approval decision: it needs the module's `approve` permission, not just `update`. */
  approvals?: { field: string; values: string[] };
  public?: { fields: string[]; filter?: Record<string, unknown>; filterable?: string[] }; // exposed on the public website catalog
  beforeSave?: (ctx: HookCtx, op: { action: 'create' | 'update'; data: Record<string, unknown>; existing?: RecordRow }) => Record<string, unknown> | void;
  afterSave?: (ctx: HookCtx, op: { action: 'create' | 'update'; record: RecordRow; previous?: RecordRow }) => void;
  beforeDelete?: (ctx: HookCtx, record: RecordRow) => void;
}
export interface KpiDef { key: string; labelEn: string; labelAr: string; entity: string; agg: 'count' | 'sum'; field?: string; where?: Record<string, string | number | boolean | (string | number)[]>; minusField?: string; period?: 'today' | 'month'; dateField?: string; money?: boolean; hidden?: boolean; permission?: string; derived?: { plus?: string[]; minus?: string[] } }
export interface ReportDef { where?: Record<string, string | number | boolean>; key: string; labelEn: string; labelAr: string; entity: string; groupBy: string; agg: 'count' | 'sum'; field?: string; permission?: string }
export interface PublicActionDef { key: string; method: 'GET' | 'POST'; write: boolean; status?: number; handler: (ctx: HookCtx, input: Record<string, unknown>) => unknown }
export interface PublicFormDef { key: string; entity: string; fields: string[]; defaults?: Record<string, unknown> }
export type ModuleAction = 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export';
export interface ProductDef {
  slug: string; entities: EntityDef[]; kpis: KpiDef[]; reports: ReportDef[]; publicForms: PublicFormDef[]; publicActions?: PublicActionDef[];
  /** permissions the default `employee` role gets in addition to nothing else (module names -> actions) */
  employeeModules: Record<string, ModuleAction[]>;
  /** job-specific staff roles (e.g. sales / warehouse / accountant): name -> label + module permissions. Created per tenant on demand; the API enforces them like any role. */
  roles?: Record<string, { labelEn: string; labelAr: string; modules: Record<string, ModuleAction[]> }>;
}

const ARABIC = '٠١٢٣٤٥٦٧٨٩', PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
export const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d))).replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)));

function validDate(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function validateField(name: string, f: FieldDef, raw: unknown, errors: Record<string, string>): unknown {
  const bad = (m: string) => { errors[name] = m; return undefined; };
  const str = () => (typeof raw === 'string' ? raw.trim() : undefined);
  switch (f.type) {
    case 'string': case 'text': {
      const s = str(); if (s === undefined) return bad('must be text');
      if (f.required && !s) return bad('is required');
      if (s.length > (f.max ?? (f.type === 'text' ? 5000 : 200))) return bad('is too long');
      return s;
    }
    case 'email': { const s = str()?.toLowerCase(); return s && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : bad('must be a valid email'); }
    case 'phone': { const s = typeof raw === 'string' ? latinDigits(raw).replace(/[\s\-().]/g, '') : ''; return /^\+?\d{7,15}$/.test(s) ? s : bad('must be a valid phone number'); }
    case 'url': { const s = str(); return s && (/^https:\/\/[^\s]+$/.test(s) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(s)) && s.length <= 500 ? s : bad('must be an https URL'); } // or an uploaded public file path
    case 'date': { const s = str(); return s && validDate(s) ? s : bad('must be a date YYYY-MM-DD'); }
    case 'time': { const s = str(); return s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : bad('must be a time HH:MM'); }
    case 'datetime': { const s = str(); return s && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s) ? s : bad('must be an ISO datetime'); }
    case 'int': case 'money': {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || !Number.isSafeInteger(raw)) return bad(f.type === 'money' ? 'must be an integer amount in minor units' : 'must be an integer');
      const min = f.type === 'money' ? Math.max(f.min ?? 0, 0) : f.min;
      if (min !== undefined && raw < min) return bad(`must be at least ${min}`);
      if (f.max !== undefined && raw > f.max) return bad(`must be at most ${f.max}`);
      return raw;
    }
    case 'bool': return typeof raw === 'boolean' ? raw : bad('must be true or false');
    case 'enum': return typeof raw === 'string' && f.values!.includes(raw) ? raw : bad(`must be one of: ${f.values!.join(', ')}`);
    case 'ref': return typeof raw === 'string' && raw.length > 0 && raw.length <= 64 ? raw : bad('must be a record id');
    case 'lines': {
      if (!Array.isArray(raw)) return bad('must be a list');
      if (raw.length > (f.max ?? 100)) return bad('has too many rows');
      return raw.map((row, i) => {
        if (row === null || typeof row !== 'object') { errors[`${name}.${i}`] = 'must be an object'; return {}; }
        const r = validateData({ fields: f.fields! }, row as Record<string, unknown>, { partial: false });
        for (const [k, m] of Object.entries(r.errors)) errors[`${name}.${i}.${k}`] = m;
        return r.data;
      });
    }
  }
}

/** Validate + normalize input for an entity. Unknown and readonly fields are dropped (no mass assignment). */
export function validateData(def: Pick<EntityDef, 'fields'>, input: unknown, opts: { partial: boolean }) {
  const errors: Record<string, string> = {}; const data: Record<string, unknown> = {};
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const [name, f] of Object.entries(def.fields)) {
    if (f.readonly) continue;
    const has = Object.prototype.hasOwnProperty.call(src, name);
    const raw = has ? src[name] : undefined;
    if (raw === undefined || raw === null) {
      if (has && raw === null && f.required) { errors[name] = 'is required'; continue; }
      if (has && raw === null) { data[name] = null; continue; }
      if (!opts.partial) { if (f.default !== undefined) data[name] = f.default; else if (f.required) errors[name] = 'is required'; }
      continue;
    }
    const v = validateField(name, f, raw, errors);
    if (v !== undefined) data[name] = v;
  }
  return { data, errors };
}

/** "Now" in the tenant's own timezone (Settings -> timezone), so past/future checks and cancellation windows follow the business's clock, not UTC. */
export function tenantLocalNow(ctx: Pick<HookCtx, 'db' | 'tenantId' | 'now'>): { date: string; minutes: number } {
  const tz = ctx.db.select({ tz: tenantsTable.timezone }).from(tenantsTable).where(eqOp(tenantsTable.id, ctx.tenantId)).get()?.tz ?? 'Africa/Cairo';
  let parts: Record<string, string> = {};
  try { parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ctx.now).map((x) => [x.type, x.value])); } catch { /* unknown timezone: fall back to UTC */ }
  if (!parts.year) { const iso = ctx.now.toISOString(); return { date: iso.slice(0, 10), minutes: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) }; }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
/** Minutes from the tenant's local "now" until a local date + HH:MM (negative = already past). */
export function minutesUntilLocal(ctx: Pick<HookCtx, 'db' | 'tenantId' | 'now'>, date: string, time: string): number {
  const n = tenantLocalNow(ctx); const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${n.date}T00:00:00Z`)) / 86_400_000;
  return days * 1440 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) - n.minutes;
}
