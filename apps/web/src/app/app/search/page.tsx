'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

export default function SearchPage() {
  const sp = useSearchParams(); const app = useApp(); const { t } = useI18n(); const q = sp.get('q') ?? ''; const [page, setPage] = useState(1);
  const res = useAsync(() => (q ? api<any[]>(`/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=20`) : Promise.resolve({ data: [], meta: { total: 0, page: 1, pageSize: 20 } })), [q, page]);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (res.loading) return <Loading />;
  const rows = res.data?.data ?? []; const total = res.data?.meta?.total ?? 0;
  return <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('search')}: {q}</h1>
    {!rows.length ? <div className="card muted">{t('noResults')}</div> : <div className="table-wrap"><table><tbody>{rows.map((r) => <tr key={r.entityType + r.entityId}><td><Link href={`/app/e/${r.entityType}/${r.entityId}`}><b>{r.title}</b></Link></td><td className="muted">{r.subtitle}</td><td><span className="badge">{app.entity(r.entityType) ? app.label(app.entity(r.entityType)!) : r.entityType}</span></td></tr>)}</tbody></table></div>}
    <div className="row between"><span className="muted small">{total} {t('results')}</span><div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previous')}</button><button className="btn sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>{t('next')}</button></div></div></>;
}
