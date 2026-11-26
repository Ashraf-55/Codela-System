'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useI18n } from './Providers';

export function FieldErr({ errs, k }: { errs?: Record<string, string[]>; k: string }) { return errs?.[k] ? <span className="err" role="alert">{errs[k].join(', ')}</span> : null; }

export function ContactForm() {
  const { t } = useI18n(); const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle'); const [err, setErr] = useState<ApiError | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; setState('busy'); setErr(null);
    try { await api('/public/leads', { method: 'POST', body: { kind: 'demo_request', name: f.name, email: f.email || undefined, phone: f.phone || undefined, company: f.company || undefined, message: f.message || undefined, website: f.website } }); setState('done'); }
    catch (x) { setErr(x as ApiError); setState('idle'); }
  }
  if (state === 'done') return <div className="alert ok" role="status">{t('sent')}</div>;
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {err && <div className="alert error" role="alert">{err.message}{err.fields && Object.entries(err.fields).map(([k, v]) => <div key={k}>{k}: {v.join(', ')}</div>)}</div>}
      <label className="field">{t('name')}<input name="name" required autoComplete="name" /></label>
      <div className="grid g2"><label className="field">{t('email')}<input name="email" type="email" autoComplete="email" className="ltr" /></label><label className="field">{t('phone')}<input name="phone" type="tel" autoComplete="tel" className="ltr" /></label></div>
      <label className="field">{t('company')}<input name="company" autoComplete="organization" /></label>
      <label className="field">{t('message')}<textarea name="message" /></label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', insetInlineStart: -9999, width: 1, height: 1 }} />
      <button className="btn primary" disabled={state === 'busy'}>{t('send')}</button>
    </form>
  );
}

export function LoginForm({ platform = false }: { platform?: boolean }) {
  const { t, locale } = useI18n(); const router = useRouter(); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [needOtp, setNeedOtp] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; setBusy(true); setErr('');
    try { await api(platform ? '/platform/auth/login' : '/auth/login', { method: 'POST', body: { email: f.email, password: f.password, otp: f.otp || undefined }, scope: platform ? 'platform' : 'tenant' }); router.push(platform ? '/admin' : '/app'); router.refresh(); }
    catch (x) { const a = x as ApiError; if (a.code === 'OTP_REQUIRED') setNeedOtp(true); setErr(a.message); setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={submit}>
      {err && <div className="alert error" role="alert">{err}</div>}
      <label className="field">{t('email')}<input name="email" type="email" required autoComplete="username" className="ltr" /></label>
      <label className="field">{t('password')}<input name="password" type="password" required autoComplete="current-password" className="ltr" /></label>
      {needOtp && <label className="field">{locale === 'ar' ? 'رمز التحقق (6 أرقام)' : 'Verification code (6 digits)'}<input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" autoFocus className="ltr" /></label>}
      <button className="btn primary" disabled={busy}>{t('login')}</button>
    </form>
  );
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38);
export function RegisterForm({ products, initialProduct }: { products: { slug: string; name: string }[]; initialProduct: string }) {
  const { t, locale } = useI18n(); const router = useRouter(); const [errs, setErrs] = useState<Record<string, string[]>>({}); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [slug, setSlug] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; setBusy(true); setErrs({}); setMsg('');
    try { await api('/auth/register-business', { method: 'POST', body: { businessName: f.businessName, slug: f.slug, productSlug: f.productSlug, name: f.name, email: f.email, password: f.password, locale } }); router.push('/app'); router.refresh(); }
    catch (x) { const a = x as ApiError; setErrs(a.fields ?? {}); setMsg(a.message); setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {msg && <div className="alert error" role="alert">{msg}</div>}
      <label className="field">{t('chooseProduct')}<select name="productSlug" defaultValue={initialProduct}>{products.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select><FieldErr errs={errs} k="productSlug" /></label>
      <label className="field">{t('businessName')}<input name="businessName" required onChange={(e) => setSlug(slugify(e.target.value))} /><FieldErr errs={errs} k="businessName" /></label>
      <label className="field">{t('businessSlug')}<input name="slug" className="ltr" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} required /><span className="hint">{slug || 'my-business'}.codela.tech</span><FieldErr errs={errs} k="slug" /></label>
      <label className="field">{t('yourName')}<input name="name" required autoComplete="name" /><FieldErr errs={errs} k="name" /></label>
      <label className="field">{t('email')}<input name="email" type="email" required autoComplete="email" className="ltr" /><FieldErr errs={errs} k="email" /></label>
      <label className="field">{t('password')}<input name="password" type="password" required autoComplete="new-password" className="ltr" /><span className="hint">{t('passwordHint')}</span><FieldErr errs={errs} k="password" /></label>
      <button className="btn primary" disabled={busy}>{t('register')}</button>
    </form>
  );
}
