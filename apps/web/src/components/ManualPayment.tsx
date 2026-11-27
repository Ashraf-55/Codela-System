'use client';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney } from '@/lib/i18n';
import { useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Instr { method: 'instapay' | 'vodafone_cash'; accountName: string; handle: string; notes: string }
interface PlanO { tier: string; nameAr: string; nameEn: string; priceMonthly: number; priceAnnual: number; currency: string }
interface AddO { key: string; nameAr: string; nameEn: string; priceMinor: number; currency: string; billingType: string; status: string }
interface Opts { methods: Instr[]; currentTier: string; plans: PlanO[]; addOns: AddO[] }
interface Row { kind?: string; addOnKey?: string | null; id: string; method: string; reference: string; amount: number; currency: string; billingPeriod: string; status: string; reviewNote: string | null; createdAt: string }
const METHOD: Record<string, string> = { instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash' };

/** Tenant side of the manual payment flow: pay outside the platform, upload the receipt, wait for Codela to approve. */
export function ManualPayment({ canManage, onChanged, preselect }: { canManage: boolean; onChanged?: () => void; preselect?: string }) {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const ins = useAsync(() => api<Opts>('/tenant/subscription/manual-payment/instructions').catch(() => ({ data: { methods: [] as Instr[], currentTier: '', plans: [] as PlanO[], addOns: [] as AddO[] } })), []);
  const [item, setItem] = useState('plan:'); // plan:<tier> | addon:<key>; 'plan:' = the current plan
  useEffect(() => { if (preselect) setItem(preselect); }, [preselect]);
  const hist = useAsync(() => api<Row[]>('/tenant/subscription/manual-payments').catch(() => ({ data: [] as Row[] })), []);
  const [method, setMethod] = useState(''); const [period, setPeriod] = useState('monthly'); const [reference, setReference] = useState(''); const [payer, setPayer] = useState('');
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const methods = ins.data?.data.methods ?? []; const o = ins.data?.data;
  const [kind, key] = item.split(':') as ['plan' | 'addon', string]; const plan = kind === 'plan' ? o?.plans.find((p) => p.tier === (key || o.currentTier)) : undefined; const add = kind === 'addon' ? o?.addOns.find((a) => a.key === key) : undefined;
  const due = add ? add.priceMinor : plan ? (period === 'annual' ? plan.priceAnnual : plan.priceMonthly) : 0; const cur = add?.currency ?? plan?.currency ?? 'EGP'; const chosen = methods.find((m) => m.method === (method || methods[0]?.method));
  const statusLabel = (s: string) => (s === 'pending' ? t('قيد المراجعة', 'Pending review') : s === 'approved' ? t('تمت الموافقة', 'Approved') : t('مرفوض', 'Rejected'));

  async function submit() {
    setMsg(null); if (!chosen) return; if (!file) { setMsg({ ok: false, text: t('ارفع صورة أو PDF للإيصال.', 'Attach the receipt image or PDF.') }); return; }
    setBusy(true);
    try {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf='))?.split('=')[1] ?? '';
      const qs = new URLSearchParams({ billingPeriod: period, method: chosen.method, kind, ...(kind === 'plan' ? { planTier: key || o!.currentTier } : { addOnKey: key }), reference: reference.trim(), ...(payer.trim() ? { payerName: payer.trim() } : {}) });
      const res = await fetch(`/api/v1/tenant/subscription/manual-payment?${qs.toString()}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', body: file,
        headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), ...(csrf ? { 'x-csrf-token': csrf } : {}) } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? res.statusText, json?.error?.fields);
      setMsg({ ok: true, text: t('تم إرسال الطلب. سيتم تفعيل الاشتراك بعد مراجعته.', 'Submitted. Your subscription is activated once the payment is reviewed.') });
      setReference(''); setPayer(''); setFile(null); hist.reload(); onChanged?.();
    } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  }

  return (
    <section className="card stack"><h3>{t('الدفع عبر InstaPay / فودافون كاش', 'Pay with InstaPay / Vodafone Cash')}</h3>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      {!methods.length ? <p className="muted">{t('لم يتم تفعيل طرق دفع يدوية بعد. تواصل مع الدعم.', 'No manual payment method is enabled yet. Contact support.')}</p> : (<>
        <ol className="small stack" style={{ paddingInlineStart: '1.2rem' }}>
          <li>{t('اختر الطريقة والفترة ثم حوّل المبلغ من خارج المنصة.', 'Choose a method and period, then transfer the amount outside the platform.')}</li>
          <li>{t('ارفع صورة الإيصال وأدخل رقم العملية.', 'Upload the receipt and enter the transfer reference.')}</li>
          <li>{t('بعد مراجعة فريق Codela يتم تفعيل اشتراكك وسيصلك إشعار.', 'After Codela reviews it your subscription is activated and you are notified.')}</li>
        </ol>
        <label className="field">{t('ماذا تدفع؟', 'What are you paying for?')}<select value={item} onChange={(e) => setItem(e.target.value)}>
          <optgroup label={t('الباقة', 'Plan')}>{o?.plans.map((p) => <option key={p.tier} value={`plan:${p.tier}`}>{locale === 'ar' ? p.nameAr : p.nameEn}{p.tier === o.currentTier ? ` — ${t('الحالية (تجديد)', 'current (renew)')}` : ''}</option>)}</optgroup>
          {!!o?.addOns.filter((a) => a.status !== 'active').length && <optgroup label={t('إضافات', 'Add-ons')}>{o.addOns.filter((a) => a.status !== 'active' || (a as { canBuy?: boolean }).canBuy).map((a) => <option key={a.key} value={`addon:${a.key}`}>{locale === 'ar' ? a.nameAr : a.nameEn}</option>)}</optgroup>}</select></label>
        {kind === 'plan' && key && key !== o?.currentTier && <div className="alert warn small" role="note">{t('سيتم تغيير باقتك بعد موافقة الإدارة على الدفع فقط.', 'Your plan changes only after the payment is approved.')}</div>}
        <div className="grid g2">
          <label className="field">{t('طريقة الدفع', 'Method')}<select value={chosen?.method ?? ''} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.method} value={m.method}>{METHOD[m.method]}</option>)}</select></label>
          {kind === 'plan' && <label className="field">{t('الفترة', 'Period')}<select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="monthly">{t('شهري', 'Monthly')}</option><option value="annual">{t('سنوي', 'Annual')}</option></select></label>}
        </div>
        {due > 0 && <div className="card flat" role="status"><div className="muted small">{t('حوّل هذا المبلغ بالضبط', 'Transfer exactly this amount')}</div><b className="mono" style={{ fontSize: '1.6rem' }}>{fmtMoney(due, cur, locale)}</b></div>}
        {chosen && <div className="alert info" role="note"><b>{METHOD[chosen.method]}</b>: <span className="mono">{chosen.handle}</span>{chosen.accountName && <> — {chosen.accountName}</>}{chosen.notes && <div className="small">{chosen.notes}</div>}</div>}
        <div className="grid g2">
          <label className="field">{t('رقم العملية / المرجع', 'Transfer reference')}<input className="ltr" data-testid="mp-reference" value={reference} maxLength={64} onChange={(e) => setReference(e.target.value)} /></label>
          <label className="field">{t('اسم المحوِّل (اختياري)', 'Payer name (optional)')}<input value={payer} maxLength={80} onChange={(e) => setPayer(e.target.value)} /></label>
        </div>
        <label className="field">{t('صورة الإيصال (PNG / JPG / WEBP / PDF حتى 5 ميجا)', 'Receipt (PNG / JPG / WEBP / PDF, max 5 MB)')}<input type="file" data-testid="mp-receipt" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <div><button className="btn primary" data-testid="mp-submit" disabled={busy || !canManage || reference.trim().length < 4 || !due} onClick={() => void submit()}>{busy ? '…' : t('إرسال للمراجعة', 'Submit for review')}</button></div>
      </>)}
      {!!hist.data?.data.length && <div className="table-wrap"><table><thead><tr><th>{t('الطريقة', 'Method')}</th><th>{t('المرجع', 'Reference')}</th><th>{t('المبلغ', 'Amount')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead><tbody>{hist.data.data.map((r) => (
        <tr key={r.id}><td>{METHOD[r.method] ?? r.method}{r.kind === 'addon' && <div className="small muted">{r.addOnKey}</div>}</td><td className="mono">{r.reference}</td><td className="mono">{fmtMoney(r.amount, r.currency, locale)}</td>
          <td><span data-testid="mp-status" className={`badge ${r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'warn' : 'bad'}`}>{statusLabel(r.status)}</span>{r.status === 'rejected' && r.reviewNote && <div className="small">{r.reviewNote}</div>}</td>
          <td><a className="btn sm" href={`/api/v1/tenant/subscription/manual-payments/${r.id}/receipt`} target="_blank" rel="noreferrer">{t('الإيصال', 'Receipt')}</a></td></tr>))}</tbody></table></div>}
    </section>
  );
}
