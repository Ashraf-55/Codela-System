'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel, fieldLabel, type Locale } from '@/lib/i18n';
import { TRACK } from '@/lib/track';

interface Spec { type: string; required: boolean; values?: string[]; entity?: string }
export function PublicForm({ formKey, label, fields, refs, locale, site }: { formKey: string; label: string; fields: Record<string, Spec>; refs: Record<string, { id: string; title: string }[]>; locale: Locale; site?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle'); const [err, setErr] = useState<ApiError | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const body: Record<string, unknown> = { website: f.get('website') }; setState('busy'); setErr(null);
    for (const [k, s] of Object.entries(fields)) { const v = f.get(k); if (v === null || v === '') continue; body[k] = s.type === 'int' ? Number(v) : s.type === 'money' ? Math.round(Number(v) * 100) : v; }
    try { await api(`/public/forms/${formKey}`, { method: 'POST', body, site }); setState('done'); } catch (x) { setErr(x as ApiError); setState('idle'); }
  }
  if (state === 'done') return <div className="alert ok" role="status">{locale === 'ar' ? 'تم الإرسال بنجاح، شكرًا لك.' : 'Sent successfully — thank you.'}</div>;
  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label={label}><h3>{label}</h3>
      {err && <div className="alert error" role="alert">{err.message}{err.fields && Object.entries(err.fields).map(([k, v]) => <div key={k}>{fieldLabel(k, locale)}: {v.join(', ')}</div>)}</div>}
      <div className="grid g2">{Object.entries(fields).map(([k, s]) => (
        <label key={k} className="field">{fieldLabel(k, locale)}{s.required && ' *'}
          {s.type === 'text' ? <textarea name={k} /> : s.type === 'enum' ? <select name={k}><option value="" />{s.values!.map((v) => <option key={v} value={v}>{enumLabel(v, locale)}</option>)}</select>
            : s.type === 'ref' ? <select name={k}><option value="" />{(refs[s.entity!] ?? []).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select>
            : <input name={k} className={['phone', 'email', 'date', 'time', 'int'].includes(s.type) ? 'ltr' : undefined} type={s.type === 'email' ? 'email' : s.type === 'phone' ? 'tel' : s.type === 'date' ? 'date' : s.type === 'time' ? 'time' : 'text'} />}</label>))}</div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
      <div><button className="btn primary" disabled={state === 'busy'}>{locale === 'ar' ? 'إرسال' : 'Send'}</button></div>
    </form>
  );
}

export function TrackWidget({ productSlug, locale, site }: { productSlug: string; locale: Locale; site?: string }) {
  const cfg = TRACK[productSlug]; const [res, setRes] = useState<Record<string, unknown> | null>(null); const [err, setErr] = useState('');
  if (!cfg) return null;
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const qs = new URLSearchParams(); for (const k of cfg.fields) qs.set(k, String(f.get(k) ?? '')); setErr(''); setRes(null);
    try { setRes((await api<Record<string, unknown>>(`/public/actions/${cfg.action}?${qs}`, { site })).data); } catch (x) { setErr((x as ApiError).message); } }
  return (
    <form className="card stack" onSubmit={submit}><h3>{cfg.label[locale]}</h3><div className="row">{cfg.fields.map((k) => <label key={k} className="field grow">{fieldLabel(k, locale)}<input name={k} required className="ltr" /></label>)}<button className="btn primary" style={{ alignSelf: 'end' }}>{locale === 'ar' ? 'بحث' : 'Search'}</button></div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {res && <dl className="dl">{Object.entries(res).filter(([, v]) => typeof v !== 'object').map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{fieldLabel(k, locale)}</dt><dd>{String(v)}</dd></div>)}</dl>}
      {res && Array.isArray((res as any).timeline) && <ol>{((res as any).timeline as { status: string; at: string }[]).map((e, i) => <li key={i}>{enumLabel(e.status, locale)} — <span className="mono small">{new Date(e.at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</span></li>)}</ol>}</form>
  );
}
