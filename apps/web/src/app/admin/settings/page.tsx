'use client';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

type V = Record<string, any>;
/** System settings: payment instructions (InstaPay / Vodafone Cash), company information and support contacts. Never credentials: those live in environment variables. */
export default function Settings() {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const pay = useAsync(() => api<{ value: V }>('/platform/settings/payment', { scope: 'platform' }), []); const co = useAsync(() => api<{ value: V }>('/platform/settings/company', { scope: 'platform' }), []);
  const [p, setP] = useState<V>({}); const [c, setC] = useState<V>({}); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState('');
  useEffect(() => { if (pay.data) setP(pay.data.data.value ?? {}); }, [pay.data]); useEffect(() => { if (co.data) setC(co.data.data.value ?? {}); }, [co.data]);
  if (pay.error) return <ErrorBox error={pay.error} retry={pay.reload} />; if (co.error) return <ErrorBox error={co.error} retry={co.reload} />; if (!pay.data || !co.data) return <Loading />;
  const ip = p.instapay ?? {}; const vc = p.vodafone_cash ?? {};
  const put = async (key: string, value: V) => { setBusy(key); setMsg(null); try { await api(`/platform/settings/${key}`, { method: 'PUT', scope: 'platform', body: { value } }); setMsg({ ok: true, text: t('تم الحفظ', 'Saved') }); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(''); } };
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('إعدادات النظام', 'System settings')}</h1>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <section className="card stack"><h3>{t('تعليمات الدفع', 'Payment instructions')}</h3><p className="hint">{t('تظهر للعملاء في صفحة الاشتراك. لا تُعرض أي طريقة إلا بعد تفعيلها هنا.', 'Shown to customers on the billing page. A method is offered only after you enable it here.')}</p>
        <div className="grid g2"><div className="stack"><label className="row"><input type="checkbox" checked={!!ip.enabled} onChange={(e) => setP({ ...p, instapay: { ...ip, enabled: e.target.checked } })} /><b>InstaPay</b></label>
          <label className="field">{t('عنوان إنستاباي', 'InstaPay address')}<input className="ltr" value={ip.handle ?? ''} onChange={(e) => setP({ ...p, instapay: { ...ip, handle: e.target.value } })} placeholder="name@instapay" /></label><label className="field">{t('اسم الحساب', 'Account name')}<input value={ip.accountName ?? ''} onChange={(e) => setP({ ...p, instapay: { ...ip, accountName: e.target.value } })} /></label></div>
          <div className="stack"><label className="row"><input type="checkbox" checked={!!vc.enabled} onChange={(e) => setP({ ...p, vodafone_cash: { ...vc, enabled: e.target.checked } })} /><b>Vodafone Cash</b></label>
            <label className="field">{t('رقم المحفظة', 'Wallet number')}<input className="ltr" inputMode="tel" value={vc.number ?? ''} onChange={(e) => setP({ ...p, vodafone_cash: { ...vc, number: e.target.value } })} placeholder="01XXXXXXXXX" /></label><label className="field">{t('اسم الحساب', 'Account name')}<input value={vc.accountName ?? ''} onChange={(e) => setP({ ...p, vodafone_cash: { ...vc, accountName: e.target.value } })} /></label></div></div>
        <label className="field">{t('ملاحظة تظهر للعميل', 'Note shown to the customer')}<textarea rows={2} maxLength={500} value={p.note ?? ''} onChange={(e) => setP({ ...p, note: e.target.value })} /></label>
        <div><button className="btn primary" disabled={busy === 'payment'} onClick={() => put('payment', p)}>{busy === 'payment' ? '…' : t('حفظ تعليمات الدفع', 'Save payment instructions')}</button></div></section>
      <section className="card stack"><h3>{t('بيانات الشركة والدعم', 'Company & support contacts')}</h3>
        <div className="grid g2">{([['name', t('اسم الشركة', 'Company name')], ['legalName', t('الاسم القانوني', 'Legal name')], ['address', t('العنوان', 'Address')], ['website', t('الموقع', 'Website')], ['supportEmail', t('بريد الدعم', 'Support e-mail')], ['supportPhone', t('هاتف الدعم', 'Support phone')], ['supportWhatsapp', t('واتساب الدعم', 'Support WhatsApp')], ['supportHours', t('ساعات الدعم', 'Support hours')]] as const).map(([k, label]) =>
          <label key={k} className="field">{label}<input className={k === 'name' || k === 'legalName' || k === 'address' || k === 'supportHours' ? '' : 'ltr'} maxLength={200} value={c[k] ?? ''} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></label>)}</div>
        <div><button className="btn primary" disabled={busy === 'company'} onClick={() => put('company', c)}>{busy === 'company' ? '…' : t('حفظ بيانات الشركة', 'Save company details')}</button></div></section>
    </>
  );
}
