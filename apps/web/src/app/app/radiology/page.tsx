'use client';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any> }
const NEXT: Record<string, string> = { requested: 'scheduled', scheduled: 'performed', performed: 'reported' };

/** Radiology technician: requested -> scheduled -> performed -> reported. The report text is required before reporting; the patient sees it in their portal once reported. */
export default function Radiology() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const get = (e: string, q = '') => api<Rec[]>(`/tenant/p/${e}?pageSize=100${q}`).then((r) => r.data);
  const open = useAsync(async () => (await Promise.all(['requested', 'scheduled', 'performed'].map((s) => get('imagingRequest', `&status=${s}`)))).flat().sort((a, b) => String(a.code).localeCompare(String(b.code))), []);
  const pts = useAsync(() => get('patient').catch(() => [] as Rec[]), []); const patient = useMemo(() => new Map((pts.data ?? []).map((p) => [p.id, p.data.name as string])), [pts.data]);
  const [when, setWhen] = useState<Record<string, string>>({}); const [report, setReport] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState('');
  if (!app.can('imaging.read')) return <div className="alert warn" role="alert">{t('هذه الشاشة للأشعة.', 'This screen is for radiology.')}</div>;
  if (open.error) return <ErrorBox error={open.error} retry={open.reload} />; if (!open.data) return <Loading />;
  async function move(r: Rec) {
    const to = NEXT[String(r.data.status)]; const body: Record<string, unknown> = { status: to };
    if (to === 'scheduled') { const w = when[r.id]; if (!w) { setMsg({ ok: false, text: t('حدّد موعد الفحص.', 'Choose the exam time.') }); return; } body.scheduledAt = new Date(w).toISOString(); }
    if (to === 'reported') { const x = (report[r.id] ?? '').trim(); if (!x) { setMsg({ ok: false, text: t('اكتب التقرير أولًا.', 'Write the report first.') }); return; } body.reportText = x; }
    setBusy(r.id); setMsg(null);
    try { await api(`/tenant/p/imagingRequest/${r.id}`, { method: 'PATCH', body }); setMsg({ ok: true, text: t('تم التحديث.', 'Updated.') }); open.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(''); }
  }
  const label = (s: string) => ({ requested: t('مطلوب', 'Requested'), scheduled: t('تم تحديد موعد', 'Scheduled'), performed: t('تم التصوير — بانتظار التقرير', 'Performed — awaiting report') } as Record<string, string>)[s] ?? s;
  const btn = (s: string) => ({ requested: t('تحديد الموعد', 'Schedule'), scheduled: t('تم إجراء الفحص', 'Mark performed'), performed: t('إصدار التقرير', 'Issue report') } as Record<string, string>)[s];
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('الأشعة', 'Radiology')}</h1>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <section className="card stack"><h3>{t('الطلبات المفتوحة', 'Open requests')} <span className="badge">{open.data.length}</span></h3>
        {!open.data.length ? <p className="muted">{t('لا توجد طلبات أشعة مفتوحة.', 'No open imaging requests.')}</p> : open.data.map((r) => { const st = String(r.data.status); return (
          <article key={r.id} className="card flat stack"><div className="row between"><div><b>{r.data.modality} — {r.data.bodyPart}</b> <span className="mono small muted">{r.code}</span><div className="small">{patient.get(String(r.data.patientId)) ?? ''}{r.data.scheduledAt ? ` · ${String(r.data.scheduledAt).slice(0, 16).replace('T', ' ')}` : ''}</div></div><span className={`badge ${st === 'performed' ? 'info' : 'warn'}`}>{label(st)}</span></div>
            {app.can('imaging.update') && <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {st === 'requested' && <label className="field">{t('موعد الفحص', 'Exam time')}<input type="datetime-local" value={when[r.id] ?? ''} onChange={(e) => setWhen({ ...when, [r.id]: e.target.value })} /></label>}
              {st === 'performed' && <label className="field" style={{ flex: 1, minWidth: 260 }}>{t('التقرير', 'Report')}<textarea rows={3} value={report[r.id] ?? ''} onChange={(e) => setReport({ ...report, [r.id]: e.target.value })} /></label>}
              <button className="btn primary" disabled={busy === r.id} onClick={() => move(r)}>{busy === r.id ? '…' : btn(st)}</button></div>}</article>); })}</section>
    </>
  );
}
