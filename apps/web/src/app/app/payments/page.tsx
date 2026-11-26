'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

const PAGE = 25;
/** Review of customers' InstaPay / Vodafone Cash payment requests. Approving creates the product's real payment (server-side rules apply); rejecting needs a reason. */
export default function Payments() {
  const app = useApp(); const { locale } = app; const t = (ar: string, en: string) => (locale === 'ar' ? ar : en); const def = app.entity('paymentRequest');
  const [status, setStatus] = useState('pending'); const [method, setMethod] = useState(''); const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<string | null>(null); const [reason, setReason] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE), sort: 'createdAt', dir: 'desc' }); if (status) qs.set('status', status); if (method) qs.set('method', method); if (q.trim()) qs.set('q', q.trim());
  const res = useAsync<{ data: Rec[]; meta?: { total: number } }>(() => (def ? api<Rec[]>(`/tenant/p/paymentRequest?${qs}`) : Promise.resolve({ data: [] as Rec[] })), [def?.key, status, method, q, page]);
  if (!def) return <div className="card stack"><p className="muted">{t('هذا المنتج لا يدعم مدفوعات العملاء اليدوية.', 'This product does not support manual customer payments.')}</p><Link className="btn" href="/app">{t('الرئيسية', 'Dashboard')}</Link></div>;
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const rows = res.data.data.filter((r) => (!from || r.createdAt.slice(0, 10) >= from) && (!to || r.createdAt.slice(0, 10) <= to)); const total = res.data.meta?.total ?? rows.length;

  async function viewReceipt(r: Rec) {
    setMsg(null);
    try { const x = await fetch(`/api/v1/tenant/customer-payments/${r.id}/receipt`, { credentials: 'same-origin', cache: 'no-store' }); if (!x.ok) throw new Error(t('الإيصال غير متاح', 'Receipt not available')); window.open(URL.createObjectURL(await x.blob()), '_blank', 'noopener'); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  async function review(r: Rec, body: Record<string, unknown>) {
    setBusy(r.id); setMsg(null);
    try { await api(`/tenant/p/paymentRequest/${r.id}`, { method: 'PATCH', body }); setMsg({ ok: true, text: `${r.code} → ${enumLabel(String(body.status), locale)}` }); setRejecting(null); setReason(''); res.reload(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(null); }
  }
  const refund = (r: Rec) => { const why = window.prompt(t('سبب الاسترداد (إلزامي). سيُسجَّل في سجل الاسترداد الخاص بالمنتج.', 'Refund reason (required). It is recorded in the product\'s own refund records.')); if (why && why.trim()) void review(r, { status: 'refunded', reviewNote: why.trim() }); };
  const approve = (r: Rec) => { if (window.confirm(t(`تأكد أن المبلغ في الإيصال ${app.money(Number(r.data.amount))} ثم اقبل الدفع؟`, `Confirm the receipt shows ${app.money(Number(r.data.amount))}, then approve?`))) void review(r, { status: 'approved' }); };

  return (
    <div className="stack">
      <h1>{t('مدفوعات العملاء', 'Customer payments')}</h1>
      <p className="muted small">{t('لا يُحتسب أي دفع إلا بعد موافقتك. القبول يسجّل دفعة حقيقية على العملية.', 'Nothing counts as paid until you approve it. Approval records a real payment on the item.')}</p>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field">{t('الحالة', 'Status')}<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t('الكل', 'All')}</option>{['pending', 'approved', 'rejected', 'refunded'].map((s) => <option key={s} value={s}>{enumLabel(s, locale)}</option>)}</select></label>
        <label className="field">{t('الطريقة', 'Method')}<select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}><option value="">{t('الكل', 'All')}</option><option value="instapay">InstaPay</option><option value="vodafone_cash">Vodafone Cash</option></select></label>
        <label className="field grow">{t('بحث (رقم / مرجع / اسم / هاتف)', 'Search (code / reference / name / phone)')}<input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field">{t('من', 'From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">{t('إلى', 'To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {rows.length === 0 ? <div className="card"><p className="muted">{t('لا توجد طلبات مطابقة.', 'No matching requests.')}</p></div> : (
        <div className="table-wrap"><table><thead><tr><th>{t('الطلب', 'Request')}</th><th>{t('على', 'For')}</th><th>{t('الطريقة', 'Method')}</th><th>{t('المبلغ', 'Amount')}</th><th>{t('المرجع', 'Reference')}</th><th>{t('الدافع', 'Payer')}</th><th>{t('التاريخ', 'Date')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="mono">{r.code}</td><td><span className="mono">{String(r.data.targetCode ?? '')}</span><br /><span className="muted small">{enumLabel(String(r.data.targetEntity ?? ''), locale)}</span></td>
              <td>{r.data.method === 'instapay' ? 'InstaPay' : 'Vodafone Cash'}</td><td className="mono">{app.money(Number(r.data.amount))}</td><td className="mono ltr">{String(r.data.reference ?? '—')}</td>
              <td>{String(r.data.payerName ?? '')}<br /><span className="muted small ltr">{String(r.data.payerPhone ?? '')}</span></td><td className="small">{r.createdAt.slice(0, 16).replace('T', ' ')}</td>
              <td><span className={`badge ${r.data.status === 'approved' ? 'ok' : r.data.status === 'rejected' || r.data.status === 'refunded' ? 'bad' : 'warn'}`}>{enumLabel(String(r.data.status), locale)}</span>{r.data.reviewNote ? <div className="small muted">{String(r.data.reviewNote)}</div> : null}</td>
              <td><div className="stack" style={{ gap: 4 }}>
                {r.data.receiptFileId ? <button className="btn sm" onClick={() => viewReceipt(r)}>{t('عرض الإيصال', 'View receipt')}</button> : <span className="muted small">{t('بدون إيصال', 'No receipt')}</span>}
                {def.canUpdate && def.canApprove && r.data.status === 'approved' && <button className="btn sm danger" disabled={busy === r.id} onClick={() => refund(r)}>{t('استرداد', 'Refund')}</button>}
                {def.canUpdate && r.data.status === 'pending' && (rejecting === r.id
                  ? <><textarea aria-label={t('سبب الرفض', 'Rejection reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('سبب الرفض', 'Rejection reason')} /><button className="btn sm danger" disabled={busy === r.id || !reason.trim()} onClick={() => review(r, { status: 'rejected', reviewNote: reason.trim() })}>{t('تأكيد الرفض', 'Confirm reject')}</button><button className="btn sm" onClick={() => setRejecting(null)}>{t('إلغاء', 'Cancel')}</button></>
                  : <><button className="btn sm primary" disabled={busy === r.id} onClick={() => approve(r)}>{t('قبول', 'Approve')}</button><button className="btn sm" onClick={() => { setRejecting(r.id); setReason(''); }}>{t('رفض', 'Reject')}</button></>)}
              </div></td></tr>))}</tbody></table></div>)}
      <div className="row between"><span className="muted small">{total}</span><div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button><button className="btn sm" disabled={page * PAGE >= total} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button></div></div>
    </div>
  );
}
