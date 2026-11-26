'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { fromMinor } from '@codela/shared';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { PRODUCT_NAMES } from '@/lib/content';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Detail { tenant: { id: string; name: string; slug: string; productSlug: string; status: string; createdAt: string }; subscription: { status: string; billingPeriod: string; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; plan: { tier: string } }; limits: Record<string, number | boolean>; usage: Record<string, number> }
interface Ev { id: string; type: string; fromStatus: string | null; toStatus: string | null; meta: { reason?: string } | null; createdAt: string }
interface Pay { id: string; kind: string; method: string; reference: string; amount: number; currency: string; status: string; addOnKey: string | null; reviewNote: string | null; createdAt: string }
interface Inv { id: string; number: string; description: string; amount: number; currency: string; status: string; paidAt: string | null }
interface TA { addOnKey: string; status: string; expiresAt: string | null }
interface AE { id: string; addOnKey: string; action: string; createdAt: string }
interface Act { id: string; action: string; entity: string | null; createdAt: string }
const d = (v: string | null) => (v ? v.slice(0, 10) : '—');

/** One customer: subscription, history, payments, add-ons, activity — plus manual activate / renew / cancel (reason required, audited). */
export default function TenantDetail() {
  const { id } = useParams<{ id: string }>(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const q = (p: string) => `/platform/tenants/${id}${p}`; const o = { scope: 'platform' as const };
  const det = useAsync(() => api<Detail>(q(''), o), [id]); const hist = useAsync(() => api<Ev[]>(q('/subscription-history'), o), [id]); const pays = useAsync(() => api<{ manual: Pay[]; invoices: Inv[] }>(q('/payments'), o).catch(() => null), [id]);
  const adds = useAsync(() => api<{ addOns: TA[]; history: AE[] }>(q('/addons'), o).catch(() => null), [id]); const act = useAsync(() => api<Act[]>(q('/activity'), o).catch(() => null), [id]);
  const [reason, setReason] = useState(''); const [period, setPeriod] = useState('monthly'); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  if (det.error) return <ErrorBox error={det.error} retry={det.reload} />; if (!det.data) return <Loading />;
  const { tenant, subscription: s } = det.data.data;
  async function run(action: 'activate' | 'renew' | 'cancel', atPeriodEnd = false) {
    if (reason.trim().length < 3) { setMsg({ ok: false, text: t('اكتب سببًا (3 أحرف على الأقل).', 'Enter a reason (at least 3 characters).') }); return; }
    if (action === 'cancel' && !window.confirm(t('تأكيد إلغاء الاشتراك؟', 'Cancel this subscription?'))) return;
    setBusy(true); setMsg(null);
    try { await api(q(`/subscription/${action}`), { method: 'POST', ...o, body: { reason, billingPeriod: period, atPeriodEnd } }); setMsg({ ok: true, text: t('تم التنفيذ وتسجيله في السجل.', 'Done and recorded in the audit log.') }); setReason(''); det.reload(); hist.reload(); act.reload(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="row between"><div><Link href="/admin/tenants" className="small">← {t('العملاء', 'Customers')}</Link><h1 style={{ fontSize: '1.6rem', margin: '4px 0 0' }}>{tenant.name}</h1><span className="mono small muted">{tenant.slug} · {PRODUCT_NAMES[tenant.productSlug]?.[locale] ?? tenant.productSlug}</span></div>
        <div className="row"><span className={`badge ${tenant.status === 'active' ? 'ok' : 'bad'}`}>{enumLabel(tenant.status, locale)}</span><span className="badge info">{s.plan.tier} · {enumLabel(s.status, locale)}</span></div></div>
      <section className="card stack"><h3>{t('الاشتراك', 'Subscription')}</h3>
        <dl className="grid g4" style={{ margin: 0 }}><div><dt className="small muted">{t('الحالة', 'Status')}</dt><dd>{enumLabel(s.status, locale)}</dd></div><div><dt className="small muted">{t('الفوترة', 'Billing')}</dt><dd>{s.billingPeriod}</dd></div><div><dt className="small muted">{t('نهاية التجربة', 'Trial ends')}</dt><dd className="mono">{d(s.trialEndsAt)}</dd></div><div><dt className="small muted">{t('نهاية الفترة', 'Period ends')}</dt><dd className="mono">{d(s.currentPeriodEnd)}{s.cancelAtPeriodEnd ? ` (${t('ينتهي', 'cancels')})` : ''}</dd></div></dl>
        {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
        <div className="grid g2"><label className="field">{t('السبب (إلزامي، يُسجَّل)', 'Reason (required, recorded)')}<input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثال: تحويل بنكي رقم ...', 'e.g. bank transfer ref ...')} /></label>
          <label className="field">{t('مدة الفوترة', 'Billing period')}<select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="monthly">{t('شهري', 'Monthly')}</option><option value="annual">{t('سنوي', 'Annual')}</option></select></label></div>
        <div className="row" style={{ flexWrap: 'wrap' }}><button className="btn primary" disabled={busy || s.status === 'active'} onClick={() => run('activate')}>{t('تفعيل', 'Activate')}</button><button className="btn" disabled={busy || s.status !== 'active'} onClick={() => run('renew')}>{t('تجديد', 'Renew')}</button><button className="btn" disabled={busy || !['active', 'trialing', 'past_due'].includes(s.status)} onClick={() => run('cancel', true)}>{t('إلغاء عند نهاية الفترة', 'Cancel at period end')}</button><button className="btn danger" disabled={busy || !['active', 'trialing', 'past_due'].includes(s.status)} onClick={() => run('cancel')}>{t('إلغاء فوري', 'Cancel now')}</button></div>
        <p className="hint">{t('التفعيل اليدوي قرار تشغيلي لا يتطلب إيصالًا؛ استخدمه فقط بعد التأكد من الدفع. كل عملية تُسجَّل باسمك.', 'Manual activation is an operator decision that does not need a receipt; use it only after confirming payment. Every action is logged under your name.')}</p></section>
      <section className="card stack"><h3>{t('سجل الاشتراك', 'Subscription history')}</h3>{!hist.data ? <Loading /> : !hist.data.data.length ? <p className="muted">—</p> : <div className="table-wrap"><table><thead><tr><th scope="col">{t('التاريخ', 'Date')}</th><th scope="col">{t('الحدث', 'Event')}</th><th scope="col">{t('من → إلى', 'From → to')}</th><th scope="col">{t('السبب', 'Reason')}</th></tr></thead><tbody>{hist.data.data.map((e) => <tr key={e.id}><td className="mono small">{d(e.createdAt)}</td><td className="mono">{e.type}</td><td>{e.fromStatus ?? '—'} → {e.toStatus ?? '—'}</td><td className="small">{e.meta?.reason ?? ''}</td></tr>)}</tbody></table></div>}</section>
      {pays.data && <section className="card stack"><h3>{t('المدفوعات', 'Payments')}</h3>{!pays.data.data.manual.length && !pays.data.data.invoices.length ? <p className="muted">—</p> : <div className="table-wrap"><table><thead><tr><th scope="col">{t('التاريخ', 'Date')}</th><th scope="col">{t('النوع', 'Type')}</th><th scope="col">{t('الطريقة', 'Method')}</th><th scope="col">{t('المرجع', 'Reference')}</th><th scope="col">{t('المبلغ', 'Amount')}</th><th scope="col">{t('الحالة', 'Status')}</th></tr></thead><tbody>{pays.data.data.manual.map((p) => <tr key={p.id}><td className="mono small">{d(p.createdAt)}</td><td>{p.kind}{p.addOnKey ? ` · ${p.addOnKey}` : ''}</td><td>{p.method}</td><td className="mono">{p.reference}</td><td className="mono">{fromMinor(p.amount, p.currency)} {p.currency}</td><td><span className={`badge ${p.status === 'approved' ? 'ok' : p.status === 'rejected' ? 'bad' : 'warn'}`}>{p.status}</span>{p.reviewNote && <div className="small muted">{p.reviewNote}</div>}</td></tr>)}</tbody></table></div>}</section>}
      {adds.data && <section className="card stack"><h3>{t('الإضافات', 'Add-ons')}</h3>{!adds.data.data.addOns.length ? <p className="muted">—</p> : <div className="table-wrap"><table><thead><tr><th scope="col">{t('الإضافة', 'Add-on')}</th><th scope="col">{t('الحالة', 'Status')}</th><th scope="col">{t('تنتهي', 'Ends')}</th></tr></thead><tbody>{adds.data.data.addOns.map((a) => <tr key={a.addOnKey}><td className="mono">{a.addOnKey}</td><td><span className={`badge ${a.status === 'active' ? 'ok' : a.status === 'renewal_due' ? 'warn' : 'bad'}`}>{a.status}</span></td><td className="mono small">{d(a.expiresAt)}</td></tr>)}</tbody></table></div>}
        {adds.data.data.history.length > 0 && <p className="small muted">{adds.data.data.history.slice(0, 8).map((h) => `${d(h.createdAt)} ${h.addOnKey}: ${h.action}`).join(' · ')}</p>}</section>}
      {act.data && <section className="card stack"><h3>{t('النشاط', 'Activity')}</h3>{!act.data.data.length ? <p className="muted">—</p> : <ul style={{ margin: 0, paddingInlineStart: 18 }}>{act.data.data.slice(0, 20).map((a) => <li key={a.id}><span className="mono small">{d(a.createdAt)}</span> <span className="mono">{a.action}</span></li>)}</ul>}</section>}
    </>
  );
}
