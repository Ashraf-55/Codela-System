'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel, type Locale } from '@/lib/i18n';

export interface BzItem { id: string; name?: string; title?: string; description?: string; bio?: string; photoUrl?: string; imageUrl?: string; client?: string; year?: number; department?: string; location?: string; type?: string; requirements?: string }
const safeImg = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);

/** Public site of a service / trading company: services, industries, portfolio, team, careers (with applications) and quotation requests. */
export function BusinessSite({ services, industries, portfolio, team, jobs, locale, site }: { services: BzItem[]; industries: BzItem[]; portfolio: BzItem[]; team: BzItem[]; jobs: BzItem[]; locale: Locale; site?: string }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [apply, setApply] = useState<BzItem | null>(null); const [state, setState] = useState<Record<string, 'idle' | 'busy' | 'done'>>({}); const [err, setErr] = useState<Record<string, string>>({});
  async function send(e: React.FormEvent<HTMLFormElement>, formKey: 'quoteRequest' | 'jobApplication', extra: Record<string, unknown> = {}) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const body: Record<string, unknown> = { website: f.get('website'), ...extra }; setState((s) => ({ ...s, [formKey]: 'busy' })); setErr((s) => ({ ...s, [formKey]: '' }));
    for (const k of ['name', 'phone', 'email', 'message', 'cvUrl']) { const v = String(f.get(k) ?? '').trim(); if (v) body[k] = v; }
    try { await api(`/public/forms/${formKey}`, { method: 'POST', body, site }); setState((s) => ({ ...s, [formKey]: 'done' })); } catch (x) { setErr((s) => ({ ...s, [formKey]: (x as ApiError).message })); setState((s) => ({ ...s, [formKey]: 'idle' })); }
  }
  const hp = <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />;
  const cards = (rows: BzItem[]) => <div className="grid g3">{rows.map((r) => <article key={r.id} className="card stack"><b>{r.name ?? r.title}</b>{r.description && <p className="small muted">{r.description}</p>}</article>)}</div>;
  return (
    <>
      {services.length > 0 && <section id="services" className="block"><div className="container stack"><h2>{t('خدماتنا', 'Our services')}</h2>{cards(services)}</div></section>}
      {industries.length > 0 && <section id="industries" className="block"><div className="container stack"><h2>{t('القطاعات التي نخدمها', 'Industries we serve')}</h2>{cards(industries)}</div></section>}
      {portfolio.length > 0 && <section id="portfolio" className="block"><div className="container stack"><h2>{t('أعمالنا', 'Our work')}</h2><div className="grid g3">{portfolio.map((p) => <article key={p.id} className="card stack">{safeImg(p.imageUrl) && <img src={safeImg(p.imageUrl)} alt={p.title ?? ''} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 10 }} />}<b>{p.title}</b><span className="muted small">{[p.client, p.year].filter(Boolean).join(' · ')}</span>{p.description && <p className="small">{p.description}</p>}</article>)}</div></div></section>}
      {team.length > 0 && <section id="team" className="block"><div className="container stack"><h2>{t('فريق العمل', 'Our team')}</h2><div className="grid g3">{team.map((m) => <article key={m.id} className="card stack">{safeImg(m.photoUrl) && <img src={safeImg(m.photoUrl)} alt={m.name ?? ''} loading="lazy" width={96} height={96} style={{ borderRadius: '50%', objectFit: 'cover' }} />}<b>{m.name}</b>{m.title && <span className="muted small">{m.title}</span>}{m.bio && <p className="small">{m.bio}</p>}</article>)}</div></div></section>}
      {jobs.length > 0 && <section id="careers" className="block"><div className="container stack" style={{ maxWidth: 820 }}><h2>{t('الوظائف المتاحة', 'Careers')}</h2>
        {jobs.map((j) => <article key={j.id} className="card stack"><div className="row between"><b>{j.title}</b><span className="badge info">{enumLabel(String(j.type ?? 'full_time'), locale)}</span></div><span className="muted small">{[j.department, j.location].filter(Boolean).join(' · ')}</span>{j.description && <p className="small">{j.description}</p>}{j.requirements && <p className="small muted">{j.requirements}</p>}
          <div><button className="btn sm primary" onClick={() => { setApply(apply?.id === j.id ? null : j); setState((s) => ({ ...s, jobApplication: 'idle' })); }}>{t('قدّم الآن', 'Apply')}</button></div>
          {apply?.id === j.id && (state.jobApplication === 'done' ? <div className="alert ok" role="status">{t('وصل طلبك، سنراجعه ونتواصل معك.', 'Application received — we will review it and get back to you.')}</div> : (
            <form className="stack" onSubmit={(e) => send(e, 'jobApplication', { jobId: j.id })} noValidate>{err.jobApplication && <div className="alert error" role="alert">{err.jobApplication}</div>}
              <div className="grid g2"><label className="field">{t('الاسم', 'Name')} *<input name="name" required /></label><label className="field">{t('البريد الإلكتروني', 'E-mail')} *<input name="email" type="email" required className="ltr" /></label></div>
              <label className="field">{t('الهاتف', 'Phone')}<input name="phone" type="tel" className="ltr" /></label><label className="field">{t('رابط السيرة الذاتية', 'CV link')}<input name="cvUrl" type="url" className="ltr" placeholder="https://" /></label><label className="field">{t('رسالة', 'Message')}<textarea name="message" /></label>{hp}
              <div><button className="btn primary" disabled={state.jobApplication === 'busy'}>{state.jobApplication === 'busy' ? '…' : t('إرسال الطلب', 'Send application')}</button></div></form>))}</article>)}</div></section>}
      <section id="quote" className="block"><div className="container stack" style={{ maxWidth: 680 }}><h2>{t('اطلب عرض سعر', 'Request a quotation')}</h2>
        {state.quoteRequest === 'done' ? <div className="alert ok" role="status">{t('وصل طلبك وسنرسل لك عرض السعر قريبًا.', 'We received your request and will send a quotation soon.')}</div> : (
          <form className="card stack" onSubmit={(e) => send(e, 'quoteRequest')} noValidate>{err.quoteRequest && <div className="alert error" role="alert">{err.quoteRequest}</div>}
            <div className="grid g2"><label className="field">{t('الاسم', 'Name')} *<input name="name" required autoComplete="name" /></label><label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label></div>
            <label className="field">{t('البريد الإلكتروني', 'E-mail')}<input name="email" type="email" className="ltr" /></label><label className="field">{t('ما الذي تحتاجه؟', 'What do you need?')} *<textarea name="message" required /></label>{hp}
            <div><button className="btn primary" disabled={state.quoteRequest === 'busy'}>{state.quoteRequest === 'busy' ? '…' : t('إرسال', 'Send')}</button></div></form>)}
      </div></section>
    </>
  );
}
