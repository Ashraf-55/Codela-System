'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel, fmtMoney } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';
import { ManualPayment } from '@/components/ManualPayment';

interface Sub { paymentMode?: string; status: string; billingPeriod: string; currentPeriodEnd: string | null; trialEndsAt: string | null; cancelAtPeriodEnd: boolean; access: string; plan: { tier: string; nameAr: string; nameEn: string; priceMonthly: number; priceAnnual: number; currency: string }; limits: Record<string, number | boolean>; usage: Record<string, number> }
interface AddOn { key: string; nameAr: string; nameEn: string; priceMinor: number; currency: string; billingType: string; status: string; expiresAt?: string | null }
export default function Billing() {
  const app = useApp(); const { t, locale } = useI18n(); const sub = useAsync(() => api<Sub>('/tenant/subscription'), []); const add = useAsync(() => api<AddOn[]>('/tenant/addons').catch(() => ({ data: [] as AddOn[] })), []); const inv = useAsync(() => api<any[]>('/tenant/billing/invoices').catch(() => ({ data: [] as any[] })), []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [period, setPeriod] = useState('monthly'); const [pre, setPre] = useState<string | undefined>();
  async function act(path: string, body?: object) { setMsg(null); try { await api(path, { method: 'POST', body: body ?? {} }); setMsg({ ok: true, text: t('saved') }); sub.reload(); add.reload(); inv.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  if (sub.error) return <ErrorBox error={sub.error} retry={sub.reload} />; if (!sub.data) return <Loading />;
  const s = sub.data.data; const canManage = app.can('subscription.manage');
  const LIM: Record<string, [string, string]> = { maxEmployees: ['الموظفون', 'Employees'], maxRecords: ['السجلات', 'Records'], maxBranches: ['الفروع', 'Branches'] };
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('billing')}</h1>
      {sub.data.data.paymentMode === 'sandbox' && <div className="alert warn" role="note">{t('sandbox')}</div>}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <div className="grid g2">
        <section className="card stack"><h3>{t('plan')}</h3>
          <div className="row between"><b>{locale === 'ar' ? s.plan.nameAr : s.plan.nameEn}</b><span className={`badge ${s.access === 'full' ? 'ok' : 'bad'}`}>{enumLabel(s.status, locale)}</span></div>
          <div className="muted">{fmtMoney(s.plan.priceMonthly, s.plan.currency, locale)} {t('perMonth')} · {fmtMoney(s.plan.priceAnnual, s.plan.currency, locale)} {t('perYear')}</div>
          {s.trialEndsAt && s.status === 'trialing' && <div className="small">{locale === 'ar' ? 'تنتهي التجربة' : 'Trial ends'}: <span className="mono">{s.trialEndsAt.slice(0, 10)}</span></div>}
          {s.currentPeriodEnd && <div className="small">{t('period')}: {enumLabel(s.billingPeriod, locale)} → <span className="mono">{s.currentPeriodEnd.slice(0, 10)}</span>{s.cancelAtPeriodEnd && <span className="badge warn"> {locale === 'ar' ? 'سيُلغى في نهاية الفترة' : 'cancels at period end'}</span>}</div>}
          {canManage && s.paymentMode === 'sandbox' && <div className="row"><select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 'auto' }}><option value="monthly">{t('monthly')}</option><option value="annual">{t('annual')}</option></select>
            <button className="btn primary" onClick={() => act('/tenant/subscription/activate', { billingPeriod: period })}>{t('activate')}</button></div>}
          {canManage && <div className="row">{(['starter', 'professional', 'business'] as const).filter((x) => x !== s.plan.tier && (s.paymentMode === 'sandbox' || ['starter', 'professional', 'business'].indexOf(x) < ['starter', 'professional', 'business'].indexOf(s.plan.tier))).map((x) => <button key={x} className="btn sm" onClick={() => act('/tenant/subscription/change-plan', { tier: x })}>{t('changePlan')}: {enumLabel(x, locale)}</button>)}
            <button className="btn sm danger" onClick={() => act('/tenant/subscription/cancel', { atPeriodEnd: true })}>{t('cancelSub')}</button></div>}
        </section>
        <section className="card stack"><h3>{t('usage')}</h3>{Object.entries(LIM).map(([k, [ar, en]]) => { const lim = Number(s.limits[k] ?? 0); const used = s.usage[k] ?? 0; return (
          <div key={k}><div className="row between small"><span>{locale === 'ar' ? ar : en}</span><b className="mono">{used} / {lim || '∞'}</b></div><div className="bar"><i style={{ width: `${lim ? Math.min(100, (used / lim) * 100) : 0}%` }} /></div></div>); })}
          <div className="small muted">{(s.limits.customDomain ? '✓' : '✗') + ' ' + (locale === 'ar' ? 'دومين مخصص' : 'Custom domain')} · {(s.limits.advancedReports ? '✓' : '✗') + ' ' + (locale === 'ar' ? 'تقارير متقدمة' : 'Advanced reports')}</div></section>
      </div>
      <div id="manual-pay" /><ManualPayment preselect={pre} canManage={canManage} onChanged={() => { sub.reload(); inv.reload(); }} />
      <section className="card stack"><h3>{t('addons')}</h3>
        {!add.data?.data.length ? <p className="muted">{t('empty')}</p> : <div className="grid g3">{add.data.data.map((a) => (
          <div key={a.key} className="card flat stack"><b>{locale === 'ar' ? a.nameAr : a.nameEn}</b><span className="muted small">{fmtMoney(a.priceMinor, a.currency, locale)} · {a.billingType === 'recurring' ? t('perMonth') : '—'}</span>
            {['active', 'renewal_due'].includes(a.status) && <button className="btn sm danger" disabled={!canManage} onClick={() => act(`/tenant/addons/${a.key}/cancel`)}>{t('cancel')}</button>}
            {(['available', 'canceled', 'expired', 'renewal_due'].includes(a.status)) && <button className="btn sm primary" disabled={!canManage} onClick={() => { if (s.paymentMode === 'sandbox') void act(`/tenant/addons/${a.key}/activate`); else { setPre(`addon:${a.key}`); document.getElementById('manual-pay')?.scrollIntoView({ behavior: 'smooth' }); } }}>{s.paymentMode === 'sandbox' ? t('activate') : a.status === 'renewal_due' || a.status === 'expired' ? (locale === 'ar' ? 'جدّد' : 'Renew') : (locale === 'ar' ? 'اشترِ' : 'Buy')}</button>}
            {a.status === 'active' && <span className="badge ok">{enumLabel('active', locale)}</span>}
            {a.status === 'renewal_due' && <span className="badge warn" role="status">{locale === 'ar' ? 'التجديد مستحق' : 'Renewal due'}</span>}
            {a.status === 'expired' && <span className="badge bad" role="status">{locale === 'ar' ? 'منتهية' : 'Expired'}</span>}
            {a.expiresAt && ['active', 'renewal_due'].includes(a.status) && <span className="small muted">{locale === 'ar' ? 'تنتهي في ' : 'Ends '}<span className="mono">{a.expiresAt.slice(0, 10)}</span></span>}
          </div>))}</div>}
      </section>
      <section className="card stack"><h3>{locale === 'ar' ? 'الفواتير' : 'Invoices'}</h3>
        {!inv.data?.data.length ? <p className="muted">{t('empty')}</p> : <div className="table-wrap"><table><thead><tr><th>#</th><th>{t('description')}</th><th>{t('amount')}</th><th>{t('status')}</th></tr></thead><tbody>{inv.data.data.map((i) => (
          <tr key={i.id}><td className="mono">{i.number}</td><td>{i.description}</td><td className="mono">{fmtMoney(i.amount, i.currency, locale)}</td><td><span className={`badge ${i.status === 'paid' ? 'ok' : 'warn'}`}>{enumLabel(i.status, locale)}</span>{i.transactions?.some((x: any) => x.simulated) && <span className="badge"> sandbox</span>}</td></tr>))}</tbody></table></div>}</section>
    </>
  );
}
