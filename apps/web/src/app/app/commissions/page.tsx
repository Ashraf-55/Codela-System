'use client';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n, confirmDialog } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any> }

/** Estate: broker commission payout. Commissions are created by completed deals; here they are reviewed per broker and marked paid (final). */
export default function Commissions() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [status, setStatus] = useState('pending'); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState('');
  const rows = useAsync(() => api<Rec[]>(`/tenant/p/commission?pageSize=100&status=${status}&sort=createdAt&dir=desc`).then((r) => r.data), [status]); const brokers = useAsync(() => api<Rec[]>('/tenant/p/broker?pageSize=100').then((r) => r.data).catch(() => [] as Rec[]), []);
  const deals = useAsync(() => api<Rec[]>('/tenant/p/saleDeal?pageSize=100').then((r) => r.data).catch(() => [] as Rec[]), []);
  const name = useMemo(() => new Map((brokers.data ?? []).map((b) => [b.id, String(b.data.name)])), [brokers.data]); const deal = useMemo(() => new Map((deals.data ?? []).map((d) => [d.id, d.code ?? ''])), [deals.data]);
  const groups = useMemo(() => { const m = new Map<string, Rec[]>(); for (const r of rows.data ?? []) m.set(String(r.data.brokerId), [...(m.get(String(r.data.brokerId)) ?? []), r]); return [...m.entries()]; }, [rows.data]);
  if (!app.can('commissions.read')) return <div className="alert warn" role="alert">{t('لا تملك صلاحية عرض العمولات.', 'You cannot view commissions.')}</div>;
  if (rows.error) return <ErrorBox error={rows.error} retry={rows.reload} />; if (!rows.data) return <Loading />;
  const pay = async (list: Rec[], who: string) => {
    const total = list.reduce((a, r) => a + Number(r.data.amount ?? 0), 0);
    if (!(await confirmDialog(t(`تأكيد صرف ${app.money(total)} إلى ${who}؟ الصرف نهائي.`, `Confirm paying ${app.money(total)} to ${who}? Payment is final.`)))) return;
    setBusy(who); setMsg(null); let done = 0;
    try { for (const r of list) { await api(`/tenant/p/commission/${r.id}`, { method: 'PATCH', body: { status: 'paid' } }); done++; } setMsg({ ok: true, text: t(`تم صرف ${done} عمولة.`, `${done} commission(s) paid.`) }); } catch (e) { setMsg({ ok: false, text: `${(e as ApiError).message} (${done}/${list.length})` }); } finally { setBusy(''); rows.reload(); }
  };
  const grand = (rows.data ?? []).reduce((a, r) => a + Number(r.data.amount ?? 0), 0);
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('صرف العمولات', 'Commission payouts')}</h1>
        <div className="row" role="tablist" aria-label={t('الحالة', 'Status')}>{(['pending', 'paid'] as const).map((s) => <button key={s} role="tab" aria-selected={status === s} className={`btn sm ${status === s ? 'primary' : ''}`} onClick={() => setStatus(s)}>{s === 'pending' ? t('مستحقة', 'Due') : t('مصروفة', 'Paid')}</button>)}</div></div>
      <p className="hint">{t('الإجمالي: ', 'Total: ')}<b className="mono">{app.money(grand)}</b></p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      {!groups.length ? <div className="card" style={{ textAlign: 'center' }}><p className="muted">{status === 'pending' ? t('لا توجد عمولات مستحقة.', 'No commissions due.') : t('لا توجد عمولات مصروفة.', 'No commissions paid yet.')}</p></div> : groups.map(([id, list]) => { const who = name.get(id) ?? id.slice(0, 8); const total = list.reduce((a, r) => a + Number(r.data.amount ?? 0), 0); return (
        <section key={id} className="card stack"><div className="row between"><h3>{who} <span className="badge">{list.length}</span></h3><div className="row"><b className="mono">{app.money(total)}</b>{status === 'pending' && app.can('commissions.update') && <button className="btn primary sm" disabled={busy === who} onClick={() => pay(list, who)}>{busy === who ? '…' : t('صرف الكل', 'Pay all')}</button>}</div></div>
          <div className="table-wrap"><table><thead><tr><th scope="col">{t('الكود', 'Code')}</th><th scope="col">{t('الصفقة', 'Deal')}</th><th scope="col">{t('المبلغ', 'Amount')}</th>{status === 'paid' && <th scope="col">{t('تاريخ الصرف', 'Paid on')}</th>}<th /></tr></thead>
            <tbody>{list.map((r) => <tr key={r.id}><td className="mono">{r.code}</td><td className="mono">{deal.get(String(r.data.dealId)) ?? '—'}</td><td className="mono">{app.money(Number(r.data.amount))}</td>{status === 'paid' && <td className="mono small">{String(r.data.paidAt ?? '').slice(0, 10)}</td>}<td>{status === 'pending' && app.can('commissions.update') && <button className="btn sm" disabled={busy === who} onClick={() => pay([r], who)}>{t('صرف', 'Pay')}</button>}</td></tr>)}</tbody></table></div></section>); })}
    </>
  );
}
