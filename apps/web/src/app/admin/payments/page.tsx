'use client';
import { useEffect, useState } from 'react';
import { fromMinor, toMinor } from '@codela/shared';
import { ApiError, api } from '@/lib/api';
import { fmtMoney } from '@/lib/i18n';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Row { id: string; tenantName: string; tenantSlug: string; method: string; reference: string; payerName: string | null; amount: number; currency: string; billingPeriod: string; kind?: string; addOnKey?: string | null; planName?: string | null; reviewerName?: string | null; status: string; reviewNote: string | null; reviewedAt: string | null; createdAt: string }
const METHOD: Record<string, string> = { instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash' };

function Review({ r, onDone }: { r: Row; onDone: () => void }) {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [amt, setAmt] = useState(''); const [reason, setReason] = useState(''); const [msg, setMsg] = useState('');
  async function go(kind: 'approve' | 'reject') {
    setMsg('');
    try {
      const body = kind === 'approve' ? { confirmedAmount: toMinor(amt, r.currency) } : { reason };
      await api(`/platform/manual-payments/${r.id}/${kind}`, { method: 'POST', scope: 'platform', body }); onDone();
    } catch (e) { setMsg((e as ApiError).message || 'invalid'); }
  }
  return (
    <div className="stack"><div className="small muted">{t('اكتب المبلغ الظاهر في الإيصال للموافقة', 'Type the amount shown on the receipt to approve')}</div>
      <div className="row"><input className="ltr" style={{ maxWidth: 140 }} value={amt} placeholder={fromMinor(r.amount, r.currency)} onChange={(e) => setAmt(e.target.value)} aria-label="amount" data-testid="review-amount" />
        <button className="btn sm primary" data-testid="review-approve" disabled={!amt} onClick={() => void go('approve')}>{t('موافقة', 'Approve')}</button></div>
      <div className="row"><input value={reason} placeholder={t('سبب الرفض', 'Rejection reason')} onChange={(e) => setReason(e.target.value)} aria-label="reason" />
        <button className="btn sm danger" disabled={reason.trim().length < 3} onClick={() => void go('reject')}>{t('رفض', 'Reject')}</button></div>
      {msg && <div className="alert error" role="alert">{msg}</div>}</div>
  );
}

function Instructions() {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const cur = useAsync(() => api<{ value: Record<string, any> }>('/platform/settings/payment', { scope: 'platform' }), []);
  const [v, setV] = useState({ ie: false, ih: '', ia: '', in: '', ve: false, vn: '', va: '', vo: '' }); const [msg, setMsg] = useState('');
  useEffect(() => { const x = cur.data?.data.value; if (x) setV({ ie: x.instapay?.enabled === true, ih: x.instapay?.handle ?? '', ia: x.instapay?.accountName ?? '', in: x.instapay?.notes ?? '', ve: x.vodafone_cash?.enabled === true, vn: x.vodafone_cash?.number ?? '', va: x.vodafone_cash?.accountName ?? '', vo: x.vodafone_cash?.notes ?? '' }); }, [cur.data]);
  async function save() {
    setMsg('');
    try { await api('/platform/settings/payment', { method: 'PUT', scope: 'platform', body: { value: { instapay: { enabled: v.ie, handle: v.ih, accountName: v.ia, notes: v.in }, vodafone_cash: { enabled: v.ve, number: v.vn, accountName: v.va, notes: v.vo } } } }); setMsg(t('تم الحفظ', 'Saved')); }
    catch (e) { setMsg((e as ApiError).message || 'invalid'); }
  }
  return (
    <section className="card stack"><h3>{t('بيانات الدفع (تظهر للعملاء)', 'Payment instructions (shown to customers)')}</h3>
      <div className="grid g2">
        <div className="stack"><label className="field row"><input type="checkbox" checked={v.ie} onChange={(e) => setV({ ...v, ie: e.target.checked })} />InstaPay</label>
          <label className="field">{t('عنوان InstaPay', 'InstaPay handle')}<input className="ltr" value={v.ih} onChange={(e) => setV({ ...v, ih: e.target.value })} /></label>
          <label className="field">{t('اسم الحساب', 'Account name')}<input value={v.ia} onChange={(e) => setV({ ...v, ia: e.target.value })} /></label>
          <label className="field">{t('ملاحظات', 'Notes')}<input value={v.in} onChange={(e) => setV({ ...v, in: e.target.value })} /></label></div>
        <div className="stack"><label className="field row"><input type="checkbox" checked={v.ve} onChange={(e) => setV({ ...v, ve: e.target.checked })} />Vodafone Cash</label>
          <label className="field">{t('رقم المحفظة', 'Wallet number')}<input className="ltr" value={v.vn} onChange={(e) => setV({ ...v, vn: e.target.value })} /></label>
          <label className="field">{t('اسم الحساب', 'Account name')}<input value={v.va} onChange={(e) => setV({ ...v, va: e.target.value })} /></label>
          <label className="field">{t('ملاحظات', 'Notes')}<input value={v.vo} onChange={(e) => setV({ ...v, vo: e.target.value })} /></label></div>
      </div>
      <div className="row"><button className="btn primary" onClick={() => void save()}>{t('حفظ', 'Save')}</button><span className="small">{msg}</span></div></section>
  );
}

export default function Payments() {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [status, setStatus] = useState('pending'); const res = useAsync(() => api<Row[]>(`/platform/manual-payments?status=${status}&pageSize=50`, { scope: 'platform' }), [status]);
  return (
    <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('مراجعة المدفوعات', 'Payment review')}</h1>
      <Instructions />
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 240 }} aria-label="status"><option value="pending">{t('قيد المراجعة', 'Pending')}</option><option value="approved">{t('تمت الموافقة', 'Approved')}</option><option value="rejected">{t('مرفوض', 'Rejected')}</option></select>
      {res.error ? <ErrorBox error={res.error} retry={res.reload} /> : !res.data ? <Loading /> : !res.data.data.length ? <p className="muted">{t('لا توجد طلبات.', 'No requests.')}</p> : res.data.data.map((r) => (
        <section key={r.id} className="card stack"><div className="row between"><b>{r.tenantName} <span className="muted small mono">{r.tenantSlug}</span></b><span className="mono">{fmtMoney(r.amount, r.currency, locale)} · {r.billingPeriod}</span></div>
          <div className="small"><b>{r.kind === 'addon' ? `${t('إضافة', 'Add-on')}: ${r.addOnKey}` : `${t('باقة', 'Plan')}: ${r.planName ?? '—'}`}</b> · {METHOD[r.method] ?? r.method} · <span className="mono">{r.reference}</span>{r.payerName && <> · {r.payerName}</>} · <span className="mono">{r.createdAt.slice(0, 16).replace('T', ' ')}</span></div>
          <div><a className="btn sm" href={`/api/v1/platform/manual-payments/${r.id}/receipt`} target="_blank" rel="noreferrer">{t('عرض الإيصال', 'View receipt')}</a></div>
          {r.status === 'pending' ? <Review r={r} onDone={res.reload} /> : <div className="small">{r.status === 'approved' ? t('تمت الموافقة', 'Approved') : `${t('مرفوض', 'Rejected')}: ${r.reviewNote ?? ''}`} {r.reviewerName && <span> — {r.reviewerName}</span>} {r.reviewedAt && <span className="mono">{r.reviewedAt.slice(0, 16).replace('T', ' ')}</span>}</div>}</section>))}</>
  );
}
