'use client';
import { useState } from 'react';
import { fromMinor, toMinor } from '@codela/shared';
import { ApiError, api } from '@/lib/api';
import { PRODUCT_NAMES } from '@/lib/content';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface AddOn { key: string; nameAr: string; nameEn: string; description: string; priceMinor: number; currency: string; billingType: string; compatibleProducts: string[] | '*'; grants: Record<string, number | boolean>; active: boolean }
const blank = { key: '', nameAr: '', nameEn: '', description: '', price: '0', currency: 'EGP', billingType: 'recurring', compat: '*', grants: '{}', active: true };

/** Add-on catalogue: price, billing type (monthly add-ons renew through the manual payment flow), compatible products, what each one grants. */
export default function AddOns() {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const res = useAsync(() => api<AddOn[]>('/platform/addons', { scope: 'platform' }), []);
  const [form, setForm] = useState<(typeof blank & { editing?: boolean }) | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f!, [k]: v }));
  async function save() {
    setBusy(true); setMsg(null);
    try {
      let grants: unknown; try { grants = JSON.parse(form!.grants || '{}'); } catch { throw new Error(t('المزايا يجب أن تكون JSON صحيحًا', 'Grants must be valid JSON')); }
      const body = { nameAr: form!.nameAr, nameEn: form!.nameEn, description: form!.description, priceMinor: toMinor(form!.price, form!.currency), currency: form!.currency, billingType: form!.billingType, compatibleProducts: form!.compat === '*' ? '*' : form!.compat.split(',').map((x) => x.trim()).filter(Boolean), grants, active: form!.active };
      if (form!.editing) await api(`/platform/addons/${form!.key}`, { method: 'PATCH', scope: 'platform', body }); else await api('/platform/addons', { method: 'POST', scope: 'platform', body: { key: form!.key, ...body } });
      setForm(null); setMsg({ ok: true, text: t('تم الحفظ', 'Saved') }); res.reload();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function toggle(a: AddOn) { setMsg(null); try { await api(`/platform/addons/${a.key}`, { method: 'PATCH', scope: 'platform', body: { active: !a.active } }); res.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('الإضافات المدفوعة', 'Add-ons')}</h1><button className="btn primary" onClick={() => { setMsg(null); setForm({ ...blank }); }}>{t('إضافة جديدة', 'New add-on')}</button></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      {form && <section className="card stack" aria-label={t('محرر الإضافة', 'Add-on editor')}>
        <div className="grid g2"><label className="field">key<input className="ltr" value={form.key} disabled={!!form.editing} pattern="[a-z][a-z0-9_]{2,40}" onChange={(e) => set('key', e.target.value.toLowerCase())} required /></label>
          <label className="field">{t('نوع الفوترة', 'Billing')}<select value={form.billingType} onChange={(e) => set('billingType', e.target.value)}><option value="recurring">{t('شهرية متجددة', 'Monthly (renews)')}</option><option value="one_time">{t('مرة واحدة', 'One-time')}</option></select></label>
          <label className="field">{t('الاسم (عربي)', 'Name (Arabic)')}<input value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} required /></label><label className="field">{t('الاسم (إنجليزي)', 'Name (English)')}<input className="ltr" value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} required /></label>
          <label className="field">{t('السعر', 'Price')}<input className="ltr" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} /></label><label className="field">{t('العملة', 'Currency')}<input className="ltr" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></label>
          <label className="field">{t('المنتجات المتوافقة (* للكل أو slugs بفواصل)', 'Compatible products (* or comma-separated slugs)')}<input className="ltr" value={form.compat} onChange={(e) => set('compat', e.target.value)} /><span className="hint mono">{Object.keys(PRODUCT_NAMES).join(', ')}</span></label>
          <label className="field">{t('المزايا (JSON)', 'Grants (JSON)')}<input className="ltr mono" value={form.grants} onChange={(e) => set('grants', e.target.value)} /></label></div>
        <label className="field">{t('الوصف', 'Description')}<textarea rows={2} maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="row"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />{t('متاحة للشراء', 'Available for purchase')}</label>
        <div className="row"><button className="btn primary" disabled={busy || !form.key || !form.nameAr.trim() || !form.nameEn.trim()} onClick={save}>{busy ? '…' : t('حفظ', 'Save')}</button><button className="btn" onClick={() => setForm(null)}>{t('إلغاء', 'Cancel')}</button></div></section>}
      <div className="table-wrap"><table><thead><tr><th scope="col">{t('الإضافة', 'Add-on')}</th><th scope="col">{t('السعر', 'Price')}</th><th scope="col">{t('الفوترة', 'Billing')}</th><th scope="col">{t('المنتجات', 'Products')}</th><th scope="col">{t('الحالة', 'Status')}</th><th /></tr></thead><tbody>{res.data.data.map((a) => (
        <tr key={a.key}><td><b>{locale === 'ar' ? a.nameAr : a.nameEn}</b><div className="mono small muted">{a.key}</div></td><td className="mono">{fromMinor(a.priceMinor, a.currency)} {a.currency}</td><td>{a.billingType === 'recurring' ? t('شهرية', 'Monthly') : t('مرة واحدة', 'One-time')}</td><td className="small">{a.compatibleProducts === '*' ? t('الكل', 'All') : a.compatibleProducts.join(', ')}</td>
          <td><span className={`badge ${a.active ? 'ok' : ''}`}>{a.active ? t('متاحة', 'Available') : t('متوقفة', 'Disabled')}</span></td>
          <td className="row"><button className="btn sm" onClick={() => toggle(a)}>{a.active ? t('إيقاف', 'Disable') : t('تفعيل', 'Enable')}</button><button className="btn sm" onClick={() => { setMsg(null); setForm({ key: a.key, nameAr: a.nameAr, nameEn: a.nameEn, description: a.description, price: fromMinor(a.priceMinor, a.currency), currency: a.currency, billingType: a.billingType, compat: a.compatibleProducts === '*' ? '*' : a.compatibleProducts.join(','), grants: JSON.stringify(a.grants), active: a.active, editing: true }); }}>{t('تعديل', 'Edit')}</button></td></tr>))}</tbody></table></div>
    </>
  );
}
