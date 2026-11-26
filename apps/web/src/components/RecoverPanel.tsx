'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from './Providers';

type View = 'forgot' | 'reset' | 'verify';
/** Password reset and e-mail confirmation for business owners and staff. The e-mailed links open /recover?reset=… and /recover?verify=…  */
export function RecoverPanel() {
  const { locale } = useI18n(); const tt = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [view, setView] = useState<View>('forgot'); const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('verify')) { setToken(q.get('verify')!); setView('verify'); } else if (q.get('reset')) { setToken(q.get('reset')!); setView('reset'); }
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  const val = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  const loginLink = <p className="muted small"><Link href="/login">{tt('العودة لتسجيل الدخول', 'Back to log in')}</Link></p>;
  return (
    <div className="card stack">
      <Link href="/" className="logo">codela<i>.</i></Link>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}

      {view === 'forgot' && <>
        <h2>{tt('نسيت كلمة المرور', 'Forgot your password')}</h2>
        {done ? loginLink : <form className="stack" onSubmit={(e) => { e.preventDefault(); const f = val(e); void run(async () => { await api('/auth/forgot-password', { method: 'POST', body: { email: f.email } }); setDone(true); setMsg({ ok: true, text: tt('إن كان البريد مسجلًا فسيصلك رابط إعادة التعيين خلال دقائق.', 'If that e-mail is registered, a reset link is on its way.') }); }); }}>
          <label className="field">{tt('البريد الإلكتروني', 'E-mail')}<input name="email" type="email" required autoComplete="username" className="ltr" /></label>
          <button className="btn primary" disabled={busy}>{tt('أرسل الرابط', 'Send reset link')}</button>
          {loginLink}
        </form>}
      </>}

      {view === 'reset' && <>
        <h2>{tt('كلمة مرور جديدة', 'Choose a new password')}</h2>
        {done ? <p><Link className="btn primary" href="/login">{tt('تسجيل الدخول', 'Log in')}</Link></p> : <form className="stack" onSubmit={(e) => { e.preventDefault(); const f = val(e); void run(async () => {
          if (f.password !== f.confirm) throw new ApiError(400, 'MISMATCH', tt('كلمتا المرور غير متطابقتين', 'The two passwords do not match'));
          await api('/auth/reset-password', { method: 'POST', body: { token, password: f.password } }); setDone(true); setMsg({ ok: true, text: tt('تم تغيير كلمة المرور. سجّل الدخول بها الآن.', 'Password changed. You can log in with it now.') }); }); }}>
          <label className="field">{tt('كلمة المرور الجديدة', 'New password')}<input name="password" type="password" required autoComplete="new-password" className="ltr" /><span className="hint">{tt('10 أحرف على الأقل، بحروف وأرقام.', 'At least 10 characters with letters and numbers.')}</span></label>
          <label className="field">{tt('تأكيد كلمة المرور', 'Confirm password')}<input name="confirm" type="password" required autoComplete="new-password" className="ltr" /></label>
          <button className="btn primary" disabled={busy}>{tt('حفظ', 'Save')}</button>
        </form>}
      </>}

      {view === 'verify' && <>
        <h2>{tt('تأكيد البريد الإلكتروني', 'Confirm your e-mail')}</h2>
        {done ? <p><Link className="btn primary" href="/login">{tt('تسجيل الدخول', 'Log in')}</Link></p>
          : <button className="btn primary" disabled={busy} onClick={() => void run(async () => { await api('/auth/verify-email', { method: 'POST', body: { token } }); setDone(true); setMsg({ ok: true, text: tt('تم تأكيد بريدك.', 'E-mail confirmed.') }); })}>{tt('تأكيد', 'Confirm')}</button>}
      </>}
    </div>
  );
}
