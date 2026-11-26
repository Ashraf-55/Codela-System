'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { PRODUCT_NAMES } from '@/lib/content';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

export default function Tenants() {
  const { t, locale } = useI18n(); const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [page, setPage] = useState(1); const [msg, setMsg] = useState('');
  useEffect(() => { const h = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(h); }, [q]);
  const res = useAsync(() => api<any[]>(`/platform/tenants?page=${page}&pageSize=20${dq ? `&q=${encodeURIComponent(dq)}` : ''}`, { scope: 'platform' }), [dq, page]);
  async function setStatus(id: string, status: string) { setMsg(''); try { await api(`/platform/tenants/${id}/status`, { method: 'PATCH', body: { status }, scope: 'platform' }); res.reload(); } catch (e) { setMsg((e as ApiError).message); } }
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />;
  const total = res.data?.meta?.total ?? 0;
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('tenants')}</h1><a className="btn sm" href="/api/v1/platform/exports/tenants.csv" download>{locale === 'ar' ? 'تصدير CSV' : 'Export CSV'}</a></div><input type="search" style={{ maxWidth: 360 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('search')} />
      {msg && <div className="alert error" role="alert">{msg}</div>}
      {!res.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>{t('name')}</th><th>slug</th><th>{t('products')}</th><th>{t('plan')}</th><th>{t('status')}</th><th /></tr></thead><tbody>{res.data.data.map((r) => (
        <tr key={r.id}><td><Link href={`/admin/tenants/${r.id}`}><b>{r.name}</b></Link></td><td className="mono">{r.slug}</td><td>{PRODUCT_NAMES[r.productSlug]?.[locale] ?? r.productSlug}</td><td>{r.planTier} <span className="badge">{enumLabel(r.subscriptionStatus ?? '—', locale)}</span></td>
          <td><span className={`badge ${r.status === 'active' ? 'ok' : 'bad'}`}>{enumLabel(r.status, locale)}</span></td>
          <td>{r.status === 'active' ? <button className="btn sm danger" onClick={() => setStatus(r.id, 'suspended')}>{t('suspend')}</button> : <button className="btn sm" onClick={() => setStatus(r.id, 'active')}>{t('reactivate')}</button>}</td></tr>))}</tbody></table></div>}
      <div className="row between"><span className="muted small">{total} {t('results')}</span><div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previous')}</button><button className="btn sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>{t('next')}</button></div></div>
    </>
  );
}
