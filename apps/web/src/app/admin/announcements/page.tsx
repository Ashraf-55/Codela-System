'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { PRODUCT_NAMES } from '@/lib/content';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Ann { id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; level: string; productSlug: string | null; startsAt: string | null; endsAt: string | null; active: boolean }
const blank = { titleAr: '', titleEn: '', bodyAr: '', bodyEn: '', level: 'info', productSlug: '', startsAt: '', endsAt: '', active: true };
const day = (v: string | null) => (v ? v.slice(0, 10) : '');

/** System announcements shown to every business owner (or one product's owners) in their dashboard. Text only: nothing here is rendered as HTML. */
export default function Announcements() {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const res = useAsync(() => api<Ann[]>('/platform/announcements', { scope: 'platform' }), []);
  const [form, setForm] = useState<typeof blank & { id?: string } | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const body = () => ({ titleAr: form!.titleAr, titleEn: form!.titleEn, bodyAr: form!.bodyAr, bodyEn: form!.bodyEn, level: form!.level, productSlug: form!.productSlug || null, startsAt: form!.startsAt || null, endsAt: form!.endsAt || null, active: form!.active });
  async function save() { setBusy(true); setMsg(null); try { if (form!.id) await api(`/platform/announcements/${form!.id}`, { method: 'PATCH', scope: 'platform', body: body() }); else await api('/platform/announcements', { method: 'POST', scope: 'platform', body: body() }); setForm(null); setMsg({ ok: true, text: t('تم الحفظ', 'Saved') }); res.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); } }
  async function toggle(a: Ann) { setMsg(null); try { await api(`/platform/announcements/${a.id}`, { method: 'PATCH', scope: 'platform', body: { active: !a.active } }); res.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  async function remove(a: Ann) { if (!window.confirm(t('حذف هذا الإعلان؟', 'Delete this announcement?'))) return; setMsg(null); try { await api(`/platform/announcements/${a.id}`, { method: 'DELETE', scope: 'platform' }); res.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f!, [k]: v }));
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('الإعلانات', 'Announcements')}</h1><button className="btn primary" onClick={() => { setMsg(null); setForm({ ...blank }); }}>{t('إعلان جديد', 'New announcement')}</button></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      {form && <section className="card stack" aria-label={t('محرر الإعلان', 'Announcement editor')}>
        <div className="grid g2"><label className="field">{t('العنوان (عربي)', 'Title (Arabic)')}<input maxLength={150} value={form.titleAr} onChange={(e) => set('titleAr', e.target.value)} required /></label><label className="field">{t('العنوان (إنجليزي)', 'Title (English)')}<input className="ltr" maxLength={150} value={form.titleEn} onChange={(e) => set('titleEn', e.target.value)} required /></label>
          <label className="field">{t('النص (عربي)', 'Text (Arabic)')}<textarea rows={3} maxLength={2000} value={form.bodyAr} onChange={(e) => set('bodyAr', e.target.value)} /></label><label className="field">{t('النص (إنجليزي)', 'Text (English)')}<textarea className="ltr" rows={3} maxLength={2000} value={form.bodyEn} onChange={(e) => set('bodyEn', e.target.value)} /></label></div>
        <div className="grid g4"><label className="field">{t('المستوى', 'Level')}<select value={form.level} onChange={(e) => set('level', e.target.value)}><option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option></select></label>
          <label className="field">{t('المنتج', 'Product')}<select value={form.productSlug} onChange={(e) => set('productSlug', e.target.value)}><option value="">{t('كل المنتجات', 'All products')}</option>{Object.entries(PRODUCT_NAMES).map(([k, n]) => <option key={k} value={k}>{n[locale]}</option>)}</select></label>
          <label className="field">{t('يبدأ', 'Starts')}<input type="date" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></label><label className="field">{t('ينتهي', 'Ends')}<input type="date" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></label></div>
        <label className="row"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />{t('مفعّل', 'Enabled')}</label>
        <div className="row"><button className="btn primary" disabled={busy || !form.titleAr.trim() || !form.titleEn.trim()} onClick={save}>{busy ? '…' : t('حفظ', 'Save')}</button><button className="btn" onClick={() => setForm(null)}>{t('إلغاء', 'Cancel')}</button></div></section>}
      {!res.data.data.length ? <div className="card" style={{ textAlign: 'center' }}><p className="muted">{t('لا توجد إعلانات.', 'No announcements yet.')}</p></div> :
        <div className="table-wrap"><table><thead><tr><th scope="col">{t('العنوان', 'Title')}</th><th scope="col">{t('المستوى', 'Level')}</th><th scope="col">{t('المنتج', 'Product')}</th><th scope="col">{t('الفترة', 'Window')}</th><th scope="col">{t('الحالة', 'Status')}</th><th /></tr></thead><tbody>{res.data.data.map((a) => (
          <tr key={a.id}><td><b>{locale === 'ar' ? a.titleAr : a.titleEn}</b></td><td><span className={`badge ${a.level === 'critical' ? 'bad' : a.level === 'warning' ? 'warn' : 'info'}`}>{a.level}</span></td><td>{a.productSlug ? PRODUCT_NAMES[a.productSlug]?.[locale] ?? a.productSlug : t('الكل', 'All')}</td><td className="mono small">{day(a.startsAt) || '—'} → {day(a.endsAt) || '—'}</td>
            <td><span className={`badge ${a.active ? 'ok' : ''}`}>{a.active ? t('مفعّل', 'Enabled') : t('متوقف', 'Disabled')}</span></td>
            <td className="row"><button className="btn sm" onClick={() => toggle(a)}>{a.active ? t('إيقاف', 'Disable') : t('تفعيل', 'Enable')}</button><button className="btn sm" onClick={() => { setMsg(null); setForm({ id: a.id, titleAr: a.titleAr, titleEn: a.titleEn, bodyAr: a.bodyAr, bodyEn: a.bodyEn, level: a.level, productSlug: a.productSlug ?? '', startsAt: day(a.startsAt), endsAt: day(a.endsAt), active: a.active }); }}>{t('تعديل', 'Edit')}</button><button className="btn sm danger" onClick={() => remove(a)}>{t('حذف', 'Delete')}</button></td></tr>))}</tbody></table></div>}
    </>
  );
}
