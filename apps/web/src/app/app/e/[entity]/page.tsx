'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { enumLabel, fieldLabel } from '@/lib/i18n';
import { Cell } from '@/components/app/Cells';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';
import { Icon } from '@/components/Icon';

const PAGE = 20;
export default function EntityList() {
  const { entity } = useParams<{ entity: string }>(); const sp = useSearchParams(); const router = useRouter(); const app = useApp(); const { t, locale } = useI18n(); const def = app.entity(entity);
  const [q, setQ] = useState(sp.get('q') ?? ''); const [dq, setDq] = useState(q); const [page, setPage] = useState(1); const [sort, setSort] = useState<{ f: string; d: 'asc' | 'desc' } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries((def?.filterable ?? []).filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!])));
  useEffect(() => { const h = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => { app.ensureRefs(Object.values(def?.fields ?? {}).map((f) => f.entity)); }, [def, app]);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE) }); if (dq) qs.set('q', dq); if (sort) { qs.set('sort', sort.f); qs.set('dir', sort.d); } for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const res = useAsync(() => api<Rec[]>(`/tenant/p/${entity}?${qs}`), [entity, qs.toString()]);
  if (!def) return <div className="alert error">404</div>;
  const cols = Object.entries(def.fields).filter(([k, f]) => f.type !== 'lines' && f.type !== 'text' && k !== def.titleField && !/Search$/.test(k)).slice(0, 5);
  const sortable = (k: string) => def.fields[k] && def.fields[k].type !== 'lines';
  /** Sortable column header: a real button (keyboard + screen reader), with aria-sort on the header cell. */
  const sortTh = (f: string, text: string) => <th key={f} scope="col" aria-sort={sort?.f === f ? (sort.d === 'asc' ? 'ascending' : 'descending') : undefined}><button type="button" className="sort-btn" onClick={() => setSort({ f, d: sort?.f === f && sort.d === 'asc' ? 'desc' : 'asc' })}>{text}{sort?.f === f && <Icon name={sort.d === 'asc' ? 'chevronDown' : 'chevronDown'} size={13} className={sort.d === 'asc' ? 'flip-v' : undefined} />}</button></th>;
  const total = res.data?.meta?.total ?? 0; const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <>
      <div className="page-head"><div><h1>{app.label(def)}</h1><p>{res.data ? `${total} ${t('results')}` : '\u00a0'}</p></div><div className="actions">{def.canExport && <a className="btn" href={`/api/v1/tenant/p/${entity}/export.csv?${new URLSearchParams([...(dq ? [['q', dq]] : []), ...Object.entries(filters).filter(([, v]) => v)]).toString()}`} download><Icon name="download" size={16} />{locale === 'ar' ? 'تصدير CSV' : 'Export CSV'}</a>}{def.canCreate && <Link className="btn primary" href={`/app/e/${entity}/new`}><Icon name="plus" size={16} />{t('create')}</Link>}</div></div>
      <div className="row">
        <span className="searchbox" style={{ maxWidth: 360 }}><Icon name="search" size={16} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('search')} style={{ paddingInlineEnd: 12 }} /></span>
        {def.filterable.filter((k) => ['enum', 'bool', 'ref'].includes(def.fields[k]?.type)).map((k) => { const f = def.fields[k]; return (
          <select key={k} aria-label={fieldLabel(k, locale)} value={filters[k] ?? ''} onChange={(e) => { setFilters((p) => ({ ...p, [k]: e.target.value })); setPage(1); }} style={{ width: 'auto' }}>
            <option value="">{fieldLabel(k, locale)}: {t('all')}</option>
            {f.type === 'enum' && f.values!.map((o) => <option key={o} value={o}>{enumLabel(o, locale)}</option>)}{f.type === 'bool' && <><option value="true">{t('yes')}</option><option value="false">{t('no')}</option></>}
            {f.type === 'ref' && app.refOptions(f.entity!).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select>); })}
      </div>
      {res.error ? <ErrorBox error={res.error} retry={res.reload} /> : res.loading && !res.data ? <Loading /> : !res.data?.data.length ? <div className="card empty"><span className="empty-icon" aria-hidden="true"><Icon name={dq || Object.values(filters).some(Boolean) ? 'search' : 'inbox'} size={22} /></span>{dq || Object.values(filters).some(Boolean) ? <><h3>{t('noResults')}</h3><p>{locale === 'ar' ? 'جرّب كلمة بحث أخرى أو امسح عوامل التصفية.' : 'Try another search term or clear the filters.'}</p><button className="btn" onClick={() => { setQ(''); setFilters({}); }}>{locale === 'ar' ? 'مسح البحث والتصفية' : 'Clear search and filters'}</button></>
          : <><h3>{t('empty')}</h3><p>{locale === 'ar' ? `أضف أول ${app.label(def)} لتبدأ.` : `Add your first ${app.label(def).toLowerCase()} to get started.`}</p>{def.canCreate && <Link className="btn primary" href={`/app/e/${entity}/new`}><Icon name="plus" size={16} />{t('create')}</Link>}</>}</div> : (
        <div className="table-wrap"><table><thead><tr>
          {def.autoCode && sortTh('code', t('code'))}
          {def.titleField !== '$code' && sortTh(def.titleField, fieldLabel(def.titleField, locale))}
          {cols.map(([k]) => sortable(k) ? sortTh(k, fieldLabel(k, locale)) : <th key={k} scope="col">{fieldLabel(k, locale)}</th>)}
        </tr></thead><tbody>{res.data.data.map((r) => (
          <tr key={r.id} tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => router.push(`/app/e/${entity}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && router.push(`/app/e/${entity}/${r.id}`)}>
            {def.autoCode && <td className="mono">{r.code}</td>}{def.titleField !== '$code' && <td><b>{String(r.data[def.titleField] ?? '—')}</b></td>}
            {cols.map(([k, f]) => <td key={k}><Cell field={f} value={r.data[k]} name={k} /></td>)}</tr>))}</tbody></table></div>
      )}
      {pages > 1 && <nav className="row between" aria-label={locale === 'ar' ? 'الصفحات' : 'Pagination'}><span className="muted small">{total} {t('results')}</span>
        <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon name={locale === 'ar' ? 'chevronRight' : 'chevronLeft'} size={14} />{t('previous')}</button><span className="small mono">{page} {t('of')} {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('next')}<Icon name={locale === 'ar' ? 'chevronLeft' : 'chevronRight'} size={14} /></button></div></nav>}
    </>
  );
}
