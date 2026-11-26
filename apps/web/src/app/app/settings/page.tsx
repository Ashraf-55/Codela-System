'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';
import { TwoFactor } from '@/components/TwoFactor';
import { StaffAvatar } from '@/components/StaffAvatar';

type Prefs = { email?: boolean; sms?: boolean; whatsapp?: boolean; reminders?: boolean; orders?: boolean };
interface S { name: string; currency: string; locale: string; timezone: string; taxBp: number; slug: string; notifyPrefs?: Prefs }
const PREF_LABELS: [keyof Prefs, string, string][] = [['email', 'رسائل البريد', 'E-mail messages'], ['sms', 'رسائل SMS', 'SMS messages'], ['whatsapp', 'رسائل واتساب', 'WhatsApp messages'], ['reminders', 'تأكيدات وتذكيرات المواعيد', 'Appointment confirmations & reminders'], ['orders', 'تحديثات حالة الطلبات', 'Order status updates']];
const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'USD', 'EUR'];
const ZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Europe/London', 'UTC'];
export default function Settings() {
  const { t, locale } = useI18n(); const res = useAsync(() => api<S>('/tenant/settings'), []); const [v, setV] = useState<S | null>(null); const [tax, setTax] = useState('0'); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (res.data) { setV(res.data.data); setTax(String(res.data.data.taxBp / 100)); } }, [res.data]);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!v) return <Loading />;
  async function save(e: FormEvent) { e.preventDefault(); setMsg(null); const taxBp = Math.round(Number(tax) * 100); if (!Number.isFinite(taxBp)) return setMsg({ ok: false, text: 'tax' });
    try { await api('/tenant/settings', { method: 'PATCH', body: { name: v!.name, currency: v!.currency, locale: v!.locale, timezone: v!.timezone, taxBp, notifyPrefs: v!.notifyPrefs ?? {} } }); setMsg({ ok: true, text: t('saved') }); res.reload(); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } }
  return (
    <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('settings')}</h1>{msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <form className="card stack" onSubmit={save}><div className="grid g2">
        <label className="field">{t('businessName')}<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="field">{locale === 'ar' ? 'العملة' : 'Currency'}<select value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select><span className="hint">{locale === 'ar' ? 'لا يمكن تغييرها بعد وجود بيانات مالية.' : 'Cannot be changed once financial data exists.'}</span></label>
        <label className="field">{locale === 'ar' ? 'لغة الموقع' : 'Website language'}<select value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })}><option value="ar">العربية</option><option value="en">English</option></select></label>
        <label className="field">{locale === 'ar' ? 'المنطقة الزمنية' : 'Time zone'}<select value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{[...new Set([v.timezone, ...ZONES])].map((z) => <option key={z}>{z}</option>)}</select></label>
        <label className="field">{locale === 'ar' ? 'الضريبة الافتراضية للطلبات أونلاين (%)' : 'Default tax for online orders (%)'}<input className="ltr" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} /></label></div>
        <fieldset className="stack" style={{ gridColumn: '1 / -1', border: 0, padding: 0 }}><legend><b>{locale === 'ar' ? 'الإشعارات الصادرة للعملاء' : 'Outgoing customer notifications'}</b></legend>
          {PREF_LABELS.map(([k, ar, en]) => <label key={k} className="row"><input type="checkbox" checked={v.notifyPrefs?.[k] !== false} onChange={(e) => setV({ ...v, notifyPrefs: { ...(v.notifyPrefs ?? {}), [k]: e.target.checked } })} />{locale === 'ar' ? ar : en}</label>)}
          <span className="muted small">{locale === 'ar' ? 'رسائل الحساب (تأكيد البريد، إعادة تعيين كلمة المرور، الفواتير) لا يمكن إيقافها.' : 'Account messages (e-mail verification, password reset, billing) cannot be switched off.'}</span></fieldset>
        <div><button className="btn primary">{t('save')}</button></div></form>
      <StaffAvatar locale={locale} />
      <TwoFactor scope="tenant" locale={locale} /></>
  );
}
