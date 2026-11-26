'use client';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any> }
interface Line { parameter: string; value: string; unit?: string; range?: string }

/** Laboratory technician: requests waiting for a sample or a result. Results are recorded per parameter (value / unit / reference range) and become visible to the patient in their portal. */
export default function Lab() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const get = (e: string, q = '') => api<Rec[]>(`/tenant/p/${e}?pageSize=100${q}`).then((r) => r.data);
  const open = useAsync(async () => [...(await get('labRequest', '&status=requested')), ...(await get('labRequest', '&status=sample_collected'))].sort((a, b) => String(a.code).localeCompare(String(b.code))), []);
  const pts = useAsync(() => get('patient').catch(() => [] as Rec[]), []); const tests = useAsync(() => get('labTest').catch(() => [] as Rec[]), []);
  const [edit, setEdit] = useState<string | null>(null); const [lines, setLines] = useState<Line[]>([]); const [text, setText] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const patient = useMemo(() => new Map((pts.data ?? []).map((p) => [p.id, p.data.name as string])), [pts.data]);
  if (!app.can('labs.read')) return <div className="alert warn" role="alert">{t('هذه الشاشة للمعمل.', 'This screen is for the laboratory.')}</div>;
  if (open.error) return <ErrorBox error={open.error} retry={open.reload} />; if (!open.data) return <Loading />;
  const catalog = new Map((tests.data ?? []).map((x) => [x.id, x]));
  const patch = async (r: Rec, body: object, ok: string) => { setBusy(true); setMsg(null); try { await api(`/tenant/p/labRequest/${r.id}`, { method: 'PATCH', body }); setMsg({ ok: true, text: ok }); setEdit(null); open.reload(); } catch (e) { const a = e as ApiError; setMsg({ ok: false, text: a.message }); } finally { setBusy(false); } };
  const start = (r: Rec) => { setEdit(r.id); setText(''); setLines([{ parameter: String(r.data.test ?? ''), value: '' }]); setMsg(null); };
  const setLine = (i: number, k: keyof Line, v: string) => setLines((all) => all.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('المعمل', 'Laboratory')}</h1>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <section className="card stack"><h3>{t('الطلبات المفتوحة', 'Open requests')} <span className="badge">{open.data.length}</span></h3>
        {!open.data.length ? <p className="muted">{t('لا توجد طلبات تحاليل مفتوحة.', 'No open lab requests.')}</p> : open.data.map((r) => { const cat = catalog.get(String(r.data.testId)); return (
          <article key={r.id} className="card flat stack"><div className="row between"><div><b>{r.data.test}</b> <span className="mono small muted">{r.code}</span><div className="small">{patient.get(String(r.data.patientId)) ?? ''}{cat?.data.sampleType ? ` · ${t('العينة', 'Sample')}: ${cat.data.sampleType}` : ''}</div></div>
            <div className="row"><span className={`badge ${r.data.status === 'requested' ? 'warn' : 'info'}`}>{r.data.status === 'requested' ? t('بانتظار العينة', 'Awaiting sample') : t('العينة مستلمة', 'Sample collected')}</span>
              {r.data.status === 'requested' && app.can('labs.update') && <button className="btn sm primary" disabled={busy} onClick={() => patch(r, { status: 'sample_collected' }, t('تم تسجيل استلام العينة.', 'Sample recorded.'))}>{t('تم أخذ العينة', 'Sample collected')}</button>}
              {r.data.status === 'sample_collected' && app.can('labs.update') && edit !== r.id && <button className="btn sm primary" onClick={() => start(r)}>{t('إدخال النتيجة', 'Enter result')}</button>}</div></div>
            {edit === r.id && <div className="stack" role="group" aria-label={t('نتيجة التحليل', 'Test result')}>
              {lines.map((l, i) => <div key={i} className="grid g4"><label className="field">{t('البند', 'Parameter')}<input value={l.parameter} maxLength={80} onChange={(e) => setLine(i, 'parameter', e.target.value)} /></label><label className="field">{t('النتيجة', 'Value')}<input value={l.value} maxLength={60} onChange={(e) => setLine(i, 'value', e.target.value)} /></label><label className="field">{t('الوحدة', 'Unit')}<input value={l.unit ?? ''} maxLength={20} onChange={(e) => setLine(i, 'unit', e.target.value)} /></label><label className="field">{t('المعدل الطبيعي', 'Range')}<span className="row"><input value={l.range ?? ''} maxLength={60} onChange={(e) => setLine(i, 'range', e.target.value)} />{lines.length > 1 && <button className="btn sm danger" onClick={() => setLines(lines.filter((_, n) => n !== i))} aria-label={t('حذف البند', 'Remove parameter')}>✕</button>}</span></label></div>)}
              <div><button className="btn sm" disabled={lines.length >= 60} onClick={() => setLines([...lines, { parameter: '', value: '' }])}>+ {t('بند', 'Parameter')}</button></div>
              <label className="field">{t('ملاحظات / تعليق', 'Notes / comment')}<textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></label>
              <div className="row"><button className="btn primary" disabled={busy || lines.some((l) => !l.parameter.trim() || !l.value.trim())} onClick={() => patch(r, { status: 'resulted', results: lines.map((l) => ({ parameter: l.parameter.trim(), value: l.value.trim(), ...(l.unit ? { unit: l.unit } : {}), ...(l.range ? { range: l.range } : {}) })), ...(text.trim() ? { resultText: text.trim() } : {}) }, t('تم حفظ النتيجة وأصبحت متاحة للمريض.', 'Result saved and visible to the patient.'))}>{t('حفظ النتيجة', 'Save result')}</button><button className="btn" onClick={() => setEdit(null)}>{t('إلغاء', 'Cancel')}</button></div></div>}</article>); })}</section>
    </>
  );
}
