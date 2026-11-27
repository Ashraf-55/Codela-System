'use client';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n, confirmDialog } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any>; createdAt?: string }

/** Fleet: review the cash drivers collected on delivery (COD) and settle it per driver. Settled collections are final. */
export default function Cash() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [status, setStatus] = useState('collected'); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState('');
  const rows = useAsync(() => api<Rec[]>(`/tenant/p/cashCollection?pageSize=100&status=${status}&sort=createdAt&dir=desc`).then((r) => r.data), [status]);
  const drivers = useAsync(() => api<Rec[]>('/tenant/p/driver?pageSize=100').then((r) => r.data).catch(() => [] as Rec[]), []);
  const name = useMemo(() => new Map((drivers.data ?? []).map((d) => [d.id, String(d.data.name)])), [drivers.data]);
  const groups = useMemo(() => { const m = new Map<string, Rec[]>(); for (const r of rows.data ?? []) m.set(String(r.data.driverId), [...(m.get(String(r.data.driverId)) ?? []), r]); return [...m.entries()]; }, [rows.data]);
  if (!app.can('collections.read')) return <div className="alert warn" role="alert">{t('لا تملك صلاحية عرض التحصيلات.', 'You cannot view collections.')}</div>;
  if (rows.error) return <ErrorBox error={rows.error} retry={rows.reload} />; if (!rows.data) return <Loading />;
  const settle = async (list: Rec[], who: string) => {
    const total = list.reduce((a, r) => a + Number(r.data.amount ?? 0), 0);
    if (!(await confirmDialog(t(`تأكيد استلام ${app.money(total)} من ${who}؟ التسوية نهائية.`, `Confirm you received ${app.money(total)} from ${who}? Settlement is final.`)))) return;
    setBusy(who); setMsg(null); let done = 0;
    try { for (const r of list) { await api(`/tenant/p/cashCollection/${r.id}`, { method: 'PATCH', body: { status: 'settled' } }); done++; } setMsg({ ok: true, text: t(`تمت تسوية ${done} تحصيل.`, `${done} collection(s) settled.`) }); }
    catch (e) { setMsg({ ok: false, text: `${(e as ApiError).message} (${done}/${list.length})` }); } finally { setBusy(''); rows.reload(); }
  };
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('تحصيلات المناديب', 'Driver cash collections')}</h1>
        <div className="row" role="tablist" aria-label={t('الحالة', 'Status')}>{(['collected', 'settled'] as const).map((s) => <button key={s} role="tab" aria-selected={status === s} className={`btn sm ${status === s ? 'primary' : ''}`} onClick={() => setStatus(s)}>{s === 'collected' ? t('بانتظار التسوية', 'To settle') : t('تمت التسوية', 'Settled')}</button>)}</div></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      {!groups.length ? <div className="card" style={{ textAlign: 'center' }}><p className="muted">{status === 'collected' ? t('لا توجد مبالغ بانتظار التسوية.', 'Nothing waiting to be settled.') : t('لا توجد تسويات.', 'No settlements.')}</p></div> : groups.map(([id, list]) => { const who = name.get(id) ?? id.slice(0, 8); const total = list.reduce((a, r) => a + Number(r.data.amount ?? 0), 0); return (
        <section key={id} className="card stack"><div className="row between"><h3>{who} <span className="badge">{list.length}</span></h3><div className="row"><b className="mono">{app.money(total)}</b>{status === 'collected' && app.can('collections.update') && <button className="btn primary sm" disabled={busy === who} onClick={() => settle(list, who)}>{busy === who ? '…' : t('تسوية الكل', 'Settle all')}</button>}</div></div>
          <div className="table-wrap"><table><thead><tr><th scope="col">{t('الكود', 'Code')}</th><th scope="col">{t('المبلغ', 'Amount')}</th><th scope="col">{t('وقت التحصيل', 'Collected')}</th>{status === 'settled' && <th scope="col">{t('وقت التسوية', 'Settled')}</th>}<th /></tr></thead>
            <tbody>{list.map((r) => <tr key={r.id}><td className="mono">{r.code}</td><td className="mono">{app.money(Number(r.data.amount))}</td><td className="mono small">{String(r.data.collectedAt ?? '').slice(0, 16).replace('T', ' ')}</td>{status === 'settled' && <td className="mono small">{String(r.data.settledAt ?? '').slice(0, 16).replace('T', ' ')}</td>}<td>{status === 'collected' && app.can('collections.update') && <button className="btn sm" disabled={busy === who} onClick={() => settle([r], who)}>{t('تسوية', 'Settle')}</button>}</td></tr>)}</tbody></table></div></section>); })}
    </>
  );
}
