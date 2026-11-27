'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Locale } from '@/lib/i18n';

interface Img { url: string; caption?: string; kind?: string }
export interface BProject { id: string; name: string; location?: string; description?: string; images?: Img[]; startDate?: string; endDate?: string }
export interface BService { id: string; name: string; description?: string }
export interface BMember { id: string; name: string; title?: string; bio?: string; photoUrl?: string }
const safeImg = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);

/** Public site of a contractor: services, completed projects with before/after photos, team, and quote / site-inspection requests. */
export function BuildSite({ services, projects, team, locale, site }: { services: BService[]; projects: BProject[]; team: BMember[]; locale: Locale; site?: string }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [open, setOpen] = useState<BProject | null>(null); const [kind, setKind] = useState<'quoteRequest' | 'inspection'>('quoteRequest'); const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle'); const [err, setErr] = useState('');
  const pair = (p: BProject) => ({ before: (p.images ?? []).filter((i) => i.kind === 'before'), after: (p.images ?? []).filter((i) => i.kind === 'after'), gallery: (p.images ?? []).filter((i) => i.kind !== 'before' && i.kind !== 'after') });
  const Photo = ({ i, label }: { i: Img; label?: string }) => { const s = safeImg(i.url); return s ? <figure style={{ margin: 0 }}><img src={s} alt={i.caption || label || ''} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 10 }} />{(label || i.caption) && <figcaption className="small muted">{label ?? i.caption}</figcaption>}</figure> : null; };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const body: Record<string, unknown> = { website: f.get('website') }; setState('busy'); setErr('');
    for (const k of ['name', 'phone', 'email', 'projectType', 'location', 'preferredDate', 'message']) { const v = String(f.get(k) ?? '').trim(); if (v) body[k] = v; }
    try { await api(`/public/forms/${kind}`, { method: 'POST', body, site }); setState('done'); } catch (x) { setErr((x as ApiError).message); setState('idle'); }
  }
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 60, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 12 };
  return (
    <>
      {services.length > 0 && <section id="services" className="block"><div className="container stack"><h2>{t('خدماتنا', 'Our services')}</h2><div className="grid g3">{services.map((s) => <article key={s.id} className="card stack"><b>{s.name}</b>{s.description && <p className="small muted">{s.description}</p>}</article>)}</div></div></section>}
      {projects.length > 0 && <section id="projects" className="block"><div className="container stack"><h2>{t('مشاريع منفّذة', 'Completed projects')}</h2>
        <div className="grid g3">{projects.map((p) => { const g = pair(p); const cover = g.after[0] ?? g.gallery[0] ?? g.before[0]; return (
          <article key={p.id} className="card stack"><button onClick={() => setOpen(p)} aria-label={p.name} style={{ all: 'unset', cursor: 'pointer', display: 'block' }}>{cover && safeImg(cover.url) ? <img src={safeImg(cover.url)} alt={p.name} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 10 }} /> : <div aria-hidden="true" style={{ aspectRatio: '4 / 3', borderRadius: 10, background: 'var(--surface-2)' }} />}</button>
            <b>{p.name}</b>{p.location && <span className="muted small">{p.location}</span>}{g.before.length > 0 && g.after.length > 0 && <span className="badge info">{t('قبل وبعد', 'Before & after')}</span>}<button className="btn sm" onClick={() => setOpen(p)}>{t('تفاصيل المشروع', 'Project details')}</button></article>); })}</div></div></section>}
      {open && (() => { const g = pair(open); return (
        <div style={overlay} onClick={() => setOpen(null)}><div className="card stack" role="dialog" aria-modal="true" aria-label={open.name} onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', maxWidth: 820, width: '100%', maxHeight: '92vh', overflow: 'auto', textAlign: 'start' }}>
          <div className="row between"><h3>{open.name}</h3><button className="btn sm" onClick={() => setOpen(null)} aria-label={t('إغلاق', 'Close')}>✕</button></div>
          <span className="muted small">{[open.location, open.startDate && open.endDate ? `${open.startDate} → ${open.endDate}` : ''].filter(Boolean).join(' · ')}</span>{open.description && <p>{open.description}</p>}
          {g.before.length > 0 && g.after.length > 0 && <div className="grid g2">{g.before.slice(0, 3).map((b, i) => <div key={`p${i}`} className="stack"><Photo i={b} label={t('قبل', 'Before')} />{g.after[i] && <Photo i={g.after[i]} label={t('بعد', 'After')} />}</div>)}</div>}
          {g.gallery.length > 0 && <div className="grid g3">{g.gallery.map((i, k) => <Photo key={k} i={i} />)}</div>}
        </div></div>); })()}
      {team.length > 0 && <section id="team" className="block"><div className="container stack"><h2>{t('فريق العمل', 'Our team')}</h2><div className="grid g3">{team.map((m) => <article key={m.id} className="card stack">{safeImg(m.photoUrl) && <img src={safeImg(m.photoUrl)} alt={m.name} loading="lazy" width={96} height={96} style={{ borderRadius: '50%', objectFit: 'cover' }} />}<b>{m.name}</b>{m.title && <span className="muted small">{m.title}</span>}{m.bio && <p className="small">{m.bio}</p>}</article>)}</div></div></section>}
      <section id="request" className="block"><div className="container stack" style={{ maxWidth: 680 }}><h2>{kind === 'inspection' ? t('اطلب معاينة', 'Request a site inspection') : t('اطلب عرض سعر', 'Request a quotation')}</h2>
        <div className="row" role="group" aria-label={t('نوع الطلب', 'Request type')}><button className={`btn sm${kind === 'quoteRequest' ? ' primary' : ''}`} aria-pressed={kind === 'quoteRequest'} onClick={() => setKind('quoteRequest')}>{t('عرض سعر', 'Quotation')}</button><button className={`btn sm${kind === 'inspection' ? ' primary' : ''}`} aria-pressed={kind === 'inspection'} onClick={() => setKind('inspection')}>{t('معاينة', 'Inspection')}</button></div>
        {state === 'done' ? <div className="alert ok" role="status">{t('وصل طلبك وسنتواصل معك قريبًا.', 'We received your request and will contact you soon.')} <button className="btn sm" onClick={() => setState('idle')}>{t('طلب آخر', 'Another request')}</button></div> : (
          <form className="card stack" onSubmit={submit} noValidate>{err && <div className="alert error" role="alert">{err}</div>}
            <div className="grid g2"><label className="field">{t('الاسم', 'Name')} *<input name="name" required autoComplete="name" /></label><label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label></div>
            <div className="grid g2"><label className="field">{t('البريد الإلكتروني', 'E-mail')}<input name="email" type="email" className="ltr" /></label><label className="field">{t('نوع المشروع', 'Project type')}<input name="projectType" placeholder={t('تشطيب شقة، بناء فيلا…', 'Apartment finishing, villa…')} /></label></div>
            <label className="field">{t('موقع المشروع', 'Project location')}<input name="location" /></label>
            {kind === 'inspection' && <label className="field">{t('التاريخ المفضل للمعاينة', 'Preferred inspection date')}<input name="preferredDate" type="date" className="ltr" min={new Date().toISOString().slice(0, 10)} /></label>}
            <label className="field">{t('تفاصيل', 'Details')}<textarea name="message" /></label>
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
            <div><button className="btn primary" disabled={state === 'busy'}>{state === 'busy' ? '…' : t('إرسال', 'Send')}</button></div></form>)}
      </div></section>
    </>
  );
}
