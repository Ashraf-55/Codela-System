'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';

interface Account { method: 'instapay' | 'vodafone_cash'; accountName: string; handle: string; notes: string }
interface Req { code: string; method: string; amount: number; status: string; reviewNote: string }
interface Due { code: string; due: number; pending: number; payable: number; accounts: Account[]; requests: Req[] }
const METHOD = { instapay: { ar: 'إنستا باي', en: 'InstaPay' }, vodafone_cash: { ar: 'فودافون كاش', en: 'Vodafone Cash' } } as const;
const STATUS = { pending: { ar: 'قيد المراجعة', en: 'Pending review' }, approved: { ar: 'مقبول', en: 'Approved' }, rejected: { ar: 'مرفوض', en: 'Rejected' }, refunded: { ar: 'تم الاسترداد', en: 'Refunded' } } as const;

/** Customer side of manual payments: prove ownership with code + phone, see what is owed and the business's InstaPay / Vodafone Cash details, submit reference and/or receipt. Never marks anything as paid. */
export function PayPanel({ productSlug, locale, currency, site }: { productSlug: string; locale: Locale; currency: string; site?: string }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const label = ({ ecommerce: ['رقم الطلب', 'Order code'], learning: ['رقم التسجيل', 'Enrollment code'], medical: ['رقم الفاتورة', 'Invoice code'], booking: ['رقم الحجز', 'Booking code'], restaurant: ['رقم الطلب', 'Order code'], automotive: ['رقم الفاتورة', 'Invoice code'], construction: ['رقم الفاتورة', 'Invoice code'], business: ['رقم الفاتورة', 'Invoice code'], fleet: ['رقم الفاتورة', 'Invoice code'] } as Record<string, [string, string]>)[productSlug] ?? ['الرقم', 'Code'];
  const [lookup, setLookup] = useState<{ code: string; phone: string } | null>(null); const [due, setDue] = useState<Due | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false); const [method, setMethod] = useState('');
  const money = (n: number) => fmtMoney(n, currency, locale);

  async function load(code: string, phone: string) {
    const r = await api<Due>(`/public/actions/paymentDue?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}`, { site }); setDue(r.data); setLookup({ code, phone }); setMethod((m) => m || r.data.accounts[0]?.method || '');
  }
  async function find(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setMsg(null);
    try { await load(String(f.get('code') ?? '').trim(), String(f.get('phone') ?? '').trim()); } catch (x) { setDue(null); setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!lookup || !due) return; const form = e.currentTarget; const f = new FormData(form); setBusy(true); setMsg(null);
    try {
      let receiptId: string | undefined; const file = f.get('receipt');
      if (file instanceof File && file.size > 0) {
        const up = await fetch('/api/v1/public/customer-payment/receipt', { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), ...(site ? { 'x-codela-site': site } : {}) }, body: file, credentials: 'same-origin', cache: 'no-store' });
        const j = await up.json().catch(() => ({})); if (!up.ok) throw new ApiError(up.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? up.statusText); receiptId = j.data.receiptId;
      }
      await api('/public/actions/submitPayment', { method: 'POST', site, body: { ...lookup, method, amount: Math.round(Number(f.get('amount')) * 100), reference: String(f.get('reference') ?? '').trim() || undefined, payerName: String(f.get('payerName') ?? '').trim() || undefined, receiptId } });
      form.reset(); setMsg({ ok: true, text: t('تم إرسال طلب الدفع. لن يُحتسب إلا بعد موافقة المسؤول.', 'Payment request sent. It counts only after the business approves it.') }); await load(lookup.code, lookup.phone);
    } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  const acc = due?.accounts.find((a) => a.method === method);
  return (
    <section id="pay" className="block"><div className="container stack" style={{ maxWidth: 720 }}>
      <h2>{t('ادفع عبر إنستا باي أو فودافون كاش', 'Pay with InstaPay or Vodafone Cash')}</h2>
      <form className="card stack" onSubmit={find}>
        <label className="field">{t(label[0], label[1])} *<input name="code" required className="ltr" autoComplete="off" /></label>
        <label className="field">{t('رقم هاتفك', 'Your phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label>
        <div><button className="btn primary" disabled={busy}>{busy && !due ? '…' : t('عرض المبلغ المستحق', 'Show amount due')}</button></div>
      </form>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {due && (
        <div className="card stack">
          <div className="row between"><b className="mono">{due.code}</b><span>{t('المستحق', 'Amount due')}: <b>{money(due.due)}</b></span></div>
          {due.pending > 0 && <p className="muted small">{t('طلبات قيد المراجعة بقيمة', 'Pending requests worth')} {money(due.pending)}</p>}
          {due.accounts.length === 0 && <div className="alert warn">{t('لم يضبط النشاط طرق دفع بعد. تواصل معه مباشرة.', 'The business has not set up payment methods yet. Please contact them directly.')}</div>}
          {due.payable > 0 && due.accounts.length > 0 && (
            <form className="stack" onSubmit={submit}>
              <div className="row" role="group" aria-label={t('طريقة الدفع', 'Payment method')}>{due.accounts.map((a) => <button type="button" key={a.method} className={`btn sm${method === a.method ? ' primary' : ''}`} aria-pressed={method === a.method} onClick={() => setMethod(a.method)}>{METHOD[a.method][locale]}</button>)}</div>
              {acc && <div className="alert info stack" style={{ gap: 2 }}><span>{t('حوّل المبلغ إلى', 'Transfer to')}: <b className="mono ltr">{acc.handle}</b></span>{acc.accountName && <span>{t('باسم', 'Account name')}: {acc.accountName}</span>}{acc.notes && <span className="small">{acc.notes}</span>}</div>}
              <label className="field">{t('المبلغ الذي حوّلته', 'Amount you transferred')} *<input name="amount" required type="number" min={0.01} step="0.01" className="ltr" defaultValue={(due.payable / 100).toFixed(2)} /></label>
              <label className="field">{t('رقم العملية / المرجع', 'Transaction reference')}<input name="reference" minLength={4} maxLength={80} className="ltr" autoComplete="off" /></label>
              <label className="field">{t('صورة الإيصال (PNG, JPG, PDF حتى 5 ميجا)', 'Receipt (PNG, JPG or PDF, up to 5 MB)')}<input name="receipt" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
              <p className="muted small">{t('اكتب رقم العملية أو أرفق الإيصال على الأقل.', 'Enter the reference or attach the receipt (at least one).')}</p>
              <label className="field">{t('اسم المحوِّل (اختياري)', 'Payer name (optional)')}<input name="payerName" maxLength={120} /></label>
              <div><button className="btn primary" disabled={busy || !method}>{busy ? '…' : t('إرسال طلب الدفع', 'Submit payment request')}</button></div>
            </form>
          )}
          {due.requests.length > 0 && <div className="stack"><b>{t('طلباتك', 'Your requests')}</b>{due.requests.map((r) => <div key={r.code} className="row between"><span><b className="mono">{r.code}</b> · {METHOD[r.method as 'instapay']?.[locale] ?? r.method} · {money(r.amount)}</span><span className={`badge ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}`}>{STATUS[r.status as 'pending']?.[locale] ?? r.status}</span>{r.reviewNote && <span className="small muted">{r.reviewNote}</span>}</div>)}</div>}
        </div>
      )}
    </div></section>
  );
}
