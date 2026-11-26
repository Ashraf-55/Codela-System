'use client';
import { enumLabel, fieldLabel, fmtMoney } from '@/lib/i18n';
import { useApp, type FieldMeta } from './AppShell';

const MONEY_KEY = /price|total|amount|fee|cost|value|salary|rent|budget|balance|paid|tax|discount|deposit|commission|revenue|stock$/i;
export function Cell({ field, value, name }: { field?: FieldMeta; value: unknown; name?: string }) {
  const app = useApp(); const { locale } = app;
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  const type = field?.type;
  if (type === 'money' || (!type && typeof value === 'number' && name && MONEY_KEY.test(name) && !/qty|stock|count/i.test(name))) return <span className="mono">{fmtMoney(Number(value), app.currency, locale)}</span>;
  if (type === 'enum') { const v = String(value); const tone = /paid$|active|completed|delivered|confirmed|published|won|available|approved|done|ready|settled/.test(v) && !/unpaid|inactive/.test(v) ? 'ok' : /cancel|reject|lost|failed|suspend|overdue|expired|returned|no_show|unpaid/.test(v) ? 'bad' : /pending|draft|new|requested|partial|reserved|waiting/.test(v) ? 'warn' : 'info'; return <span className={`badge ${tone}`}>{enumLabel(v, locale)}</span>; }
  if (type === 'bool' || typeof value === 'boolean') return <span className={`badge ${value ? 'ok' : ''}`}>{value ? (locale === 'ar' ? 'نعم' : 'Yes') : (locale === 'ar' ? 'لا' : 'No')}</span>;
  if (type === 'ref') return <>{app.refTitle(field?.entity, value)}</>;
  if (type === 'url') return <a href={String(value)} target="_blank" rel="noopener noreferrer">{String(value).replace(/^https:\/\//, '').slice(0, 28)}</a>;
  if (type === 'datetime' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))) return <span className="mono">{new Date(String(value)).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>;
  if (type === 'phone' || type === 'email' || type === 'date' || type === 'time') return <span className="mono">{String(value)}</span>;
  if (Array.isArray(value)) return <LinesView rows={value as Record<string, unknown>[]} meta={field?.fields} />;
  if (typeof value === 'object') return <span className="mono small">{JSON.stringify(value)}</span>;
  return <>{String(value)}</>;
}
export function LinesView({ rows, meta }: { rows: Record<string, unknown>[]; meta?: Record<string, FieldMeta> }) {
  const app = useApp(); if (!rows.length) return <span className="muted">—</span>;
  const keys = meta && Object.keys(meta).length ? Object.keys(meta) : [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !/Id$/.test(k));
  return (
    <div className="table-wrap"><table><thead><tr>{keys.map((k) => <th key={k}>{fieldLabel(k, app.locale)}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{keys.map((k) => <td key={k}><Cell field={meta?.[k]} name={k} value={r[k]} /></td>)}</tr>)}</tbody></table></div>
  );
}
