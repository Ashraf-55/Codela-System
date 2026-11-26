'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any> }
const days = (iso: string) => Math.floor((new Date(`${iso}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);

/** Auto: warranty on parts and services, with a live state (valid / expiring in 30 days / expired / claimed / void) and claim handling. */
export default function Warranties() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const list = useAsync(() => api<Rec[]>('/tenant/p/warranty?pageSize=100&sort=endDate&dir=asc').then((r) => r.data), []); const vehicles = useAsync(() => api<Rec[]>('/tenant/p/vehicle?pageSize=100').then((r) => r.data).catch(() => [] as Rec[]), []);
  const [tab, setTab] = useState('all'); const [q, setQ] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState('');
  const plate = useMemo(() => new Map((vehicles.data ?? []).map((v) => [v.id, `${v.data.plate ?? ''} ${v.data.make ?? ''} ${v.data.model ?? ''}`.trim()])), [vehicles.data]);
  if (!app.can('warranties.read')) return <div className="alert warn" role="alert">{t('لا تملك صلاحية عرض الضمان.', 'You cannot view warranties.')}</div>;
  if (list.error) return <ErrorBox error={list.error} retry={list.reload} />; if (!list.data) return <Loading />;
  const state = (w: Rec) => w.data.status !== 'active' ? String(w.data.status) : days(String(w.data.endDate)) < 0 ? 'expired' : days(String(w.data.endDate)) <= 30 ? 'expiring' : 'valid';
  const label: Record<string, string> = { valid: t('ساري', 'Valid'), expiring: t('ينتهي قريبًا', 'Expiring soon'), expired: t('منتهي', 'Expired'), claimed: t('تمت المطالبة', 'Claimed'), void: t('ملغي', 'Void') };
  const tone: Record<string, string> = { valid: 'ok', expiring: 'warn', expired: 'bad', claimed: 'info', void: '' };
  const shown = list.data.filter((w) => (tab === 'all' || state(w) === tab) && (!q.trim() || `${w.code} ${w.data.description} ${plate.get(String(w.data.vehicleId)) ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  async function act(w: Rec, status: 'claimed' | 'void') {
    const note = status === 'claimed' ? window.prompt(t('وصف المطالبة (إلزامي)', 'Claim details (required)')) : window.confirm(t('إلغاء هذا الضمان؟', 'Void this warranty?')) ? '' : null;
    if (note === null || (status === 'claimed' && !note.trim())) return; setBusy(w.id); setMsg(null);
    try { await api(`/tenant/p/warranty/${w.id}`, { method: 'PATCH', body: { status, ...(status === 'claimed' ? { claimNote: note.trim() } : {}) } }); setMsg({ ok: true, text: `${w.code} → ${label[status]}` }); list.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(''); }
  }
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('الضمان', 'Warranties')}</h1>{app.can('warranties.create') && <Link className="btn primary" href="/app/e/warranty/new">{t('ضمان جديد', 'New warranty')}</Link>}</div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}><input type="search" aria-label={t('بحث', 'Search')} placeholder={t('بحث بالكود أو اللوحة أو الوصف', 'Search code, plate or description')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <div role="tablist" className="row" aria-label={t('الحالة', 'State')}>{['all', 'valid', 'expiring', 'expired', 'claimed', 'void'].map((s) => <button key={s} role="tab" aria-selected={tab === s} className={`btn sm ${tab === s ? 'primary' : ''}`} onClick={() => setTab(s)}>{s === 'all' ? t('الكل', 'All') : label[s]} {s !== 'all' && <span className="badge">{list.data!.filter((w) => state(w) === s).length}</span>}</button>)}</div></div>
      {!shown.length ? <div className="card" style={{ textAlign: 'center' }}><p className="muted">{list.data.length ? t('لا توجد نتائج.', 'No results.') : t('لا توجد ضمانات مسجلة.', 'No warranties yet.')}</p></div> :
        <div className="table-wrap"><table><thead><tr><th scope="col">{t('الكود', 'Code')}</th><th scope="col">{t('السيارة', 'Vehicle')}</th><th scope="col">{t('البيان', 'Covers')}</th><th scope="col">{t('ينتهي', 'Ends')}</th><th scope="col">{t('الحالة', 'State')}</th><th /></tr></thead>
          <tbody>{shown.map((w) => { const s = state(w); return <tr key={w.id}><td className="mono"><Link href={`/app/e/warranty/${w.id}`}>{w.code}</Link></td><td>{plate.get(String(w.data.vehicleId)) ?? '—'}</td><td>{w.data.description}<div className="small muted">{w.data.kind === 'part' ? t('قطعة', 'Part') : t('خدمة', 'Service')} · {w.data.months} {t('شهر', 'mo')}</div></td><td className="mono">{w.data.endDate}</td>
            <td><span className={`badge ${tone[s]}`}>{label[s]}</span>{w.data.claimNote && <div className="small muted">{w.data.claimNote}</div>}</td>
            <td className="row">{w.data.status === 'active' && app.can('warranties.update') && <><button className="btn sm" disabled={busy === w.id || s === 'expired'} onClick={() => act(w, 'claimed')}>{t('مطالبة', 'Claim')}</button><button className="btn sm danger" disabled={busy === w.id} onClick={() => act(w, 'void')}>{t('إلغاء', 'Void')}</button></>}</td></tr>; })}</tbody></table></div>}
    </>
  );
}
