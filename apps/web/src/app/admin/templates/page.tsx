'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Override { channel: string; subjectAr: string; subjectEn: string; bodyAr: string; bodyEn: string; active: boolean }
interface Tpl { key: string; vars: string[]; required: string[]; builtIn: { subject: string; body: string }; overrides: (Override & { key: string })[] }
const CHANNELS = ['email', 'sms', 'whatsapp'];

/** Notification templates: edit the wording of system messages. Only the listed {{variables}} are accepted; the server validates on every preview and save. */
export default function Templates() {
  const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const res = useAsync(() => api<Tpl[]>('/platform/notification-templates', { scope: 'platform' }), []);
  const [key, setKey] = useState<string | null>(null); const [f, setF] = useState<Override>({ channel: 'email', subjectAr: '', subjectEn: '', bodyAr: '', bodyEn: '', active: true });
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const tpl = res.data.data.find((x) => x.key === key);
  const open = (x: Tpl, channel = 'email') => { const o = x.overrides.find((y) => y.channel === channel); setKey(x.key); setPreview(null); setMsg(null); setF(o ? { channel, subjectAr: o.subjectAr, subjectEn: o.subjectEn, bodyAr: o.bodyAr, bodyEn: o.bodyEn, active: o.active } : { channel, subjectAr: '', subjectEn: x.builtIn.subject, bodyAr: '', bodyEn: x.builtIn.body, active: true }); };
  const run = async (what: 'preview' | 'save' | 'reset') => {
    setBusy(true); setMsg(null);
    try {
      if (what === 'preview') { const r = await api<{ subject: string; body: string }>(`/platform/notification-templates/${key}/preview`, { method: 'POST', scope: 'platform', body: f }); setPreview(r.data); }
      else if (what === 'save') { await api(`/platform/notification-templates/${key}`, { method: 'PUT', scope: 'platform', body: f }); setMsg({ ok: true, text: t('تم الحفظ', 'Saved') }); res.reload(); }
      else { await api(`/platform/notification-templates/${key}?channel=${f.channel}`, { method: 'DELETE', scope: 'platform' }); setMsg({ ok: true, text: t('تمت العودة للنص الافتراضي', 'Restored the built-in wording') }); setKey(null); res.reload(); }
    } catch (e) { setPreview(null); setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  };
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('قوالب الإشعارات', 'Notification templates')}</h1>
      <p className="hint">{t('عدّل صياغة الرسائل التي يرسلها النظام. استخدم المتغيّرات بصيغة {{name}} فقط من القائمة المسموحة لكل قالب.', 'Edit the wording of the messages the system sends. Use only the {{variable}} names listed for each template.')}</p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <div className="table-wrap"><table><thead><tr><th scope="col">{t('القالب', 'Template')}</th><th scope="col">{t('المتغيّرات', 'Variables')}</th><th scope="col">{t('مُعدَّل', 'Customised')}</th><th /></tr></thead><tbody>{res.data.data.map((x) => (
        <tr key={x.key}><td className="mono">{x.key}</td><td className="mono small">{x.vars.map((v) => `{{${v}}}`).join(' ')}</td><td>{x.overrides.length ? x.overrides.map((o) => <span key={o.channel} className={`badge ${o.active ? 'ok' : ''}`}>{o.channel}</span>) : <span className="muted small">—</span>}</td><td><button className="btn sm" onClick={() => open(x)}>{t('تحرير', 'Edit')}</button></td></tr>))}</tbody></table></div>
      {tpl && <section className="card stack" aria-label={t('محرر القالب', 'Template editor')}>
        <div className="row between"><h3>{tpl.key}</h3><label className="field row">{t('القناة', 'Channel')}<select value={f.channel} onChange={(e) => open(tpl, e.target.value)} style={{ width: 'auto' }}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label></div>
        <p className="small muted">{t('المتغيّرات المسموحة: ', 'Allowed variables: ')}<span className="mono">{tpl.vars.map((v) => `{{${v}}}`).join(' ')}</span>{tpl.required.length > 0 && <> · {t('إلزامي: ', 'Required: ')}<span className="mono">{tpl.required.map((v) => `{{${v}}}`).join(' ')}</span></>}</p>
        <div className="grid g2"><label className="field">{t('الموضوع (إنجليزي)', 'Subject (English)')}<input className="ltr" maxLength={200} value={f.subjectEn} onChange={(e) => setF({ ...f, subjectEn: e.target.value })} /></label><label className="field">{t('الموضوع (عربي)', 'Subject (Arabic)')}<input maxLength={200} value={f.subjectAr} onChange={(e) => setF({ ...f, subjectAr: e.target.value })} /></label>
          <label className="field">{t('النص (إنجليزي)', 'Body (English)')}<textarea className="ltr" rows={5} maxLength={4000} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} /></label><label className="field">{t('النص (عربي)', 'Body (Arabic)')}<textarea rows={5} maxLength={4000} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} /></label></div>
        <label className="row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t('استخدم هذا النص بدل الافتراضي', 'Use this wording instead of the built-in one')}</label>
        <div className="row" style={{ flexWrap: 'wrap' }}><button className="btn" disabled={busy || !f.bodyEn.trim() || !f.bodyAr.trim()} onClick={() => run('preview')}>{t('معاينة', 'Preview')}</button><button className="btn primary" disabled={busy || !f.bodyEn.trim() || !f.bodyAr.trim()} onClick={() => run('save')}>{t('حفظ', 'Save')}</button>
          {tpl.overrides.some((o) => o.channel === f.channel) && <button className="btn danger" disabled={busy} onClick={() => run('reset')}>{t('استعادة الافتراضي', 'Restore built-in')}</button>}<button className="btn" onClick={() => setKey(null)}>{t('إغلاق', 'Close')}</button></div>
        {preview && <div className="card flat" role="region" aria-label={t('المعاينة', 'Preview')}><b>{preview.subject || '—'}</b><pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', font: 'inherit' }}>{preview.body}</pre></div>}</section>}
    </>
  );
}
