'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type Scope } from '@/lib/api';

/** Self-service two-factor authentication (TOTP). Works for staff (`tenant`) and platform admins (`platform`). */
export function TwoFactor({ scope, locale }: { scope: Scope; locale: 'ar' | 'en' }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [enabled, setEnabled] = useState<boolean | null>(null); const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false); const p = scope === 'platform' ? '/platform/auth/2fa' : '/auth/2fa';
  useEffect(() => { api<{ enabled: boolean }>(`${p}/status`, { scope }).then((r) => setEnabled(r.data.enabled)).catch(() => setEnabled(null)); }, [p, scope]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); } };
  const val = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  if (enabled === null) return null;
  return (
    <section className="card stack" aria-labelledby="tfa"><h3 id="tfa">{t('التحقق بخطوتين', 'Two-factor authentication')}</h3>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {!enabled && !setup && <><p className="muted small">{t('أضف طبقة حماية: رمز من تطبيق المصادقة (Google Authenticator أو غيره) عند كل دخول.', 'Add a second step: a code from an authenticator app (Google Authenticator or similar) at every sign-in.')}</p>
        <div><button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await api<{ secret: string; otpauthUrl: string }>(`${p}/setup`, { method: 'POST', body: {}, scope }); setSetup(r.data); })}>{t('تفعيل', 'Enable')}</button></div></>}
      {!enabled && setup && <form className="stack" onSubmit={(e) => { e.preventDefault(); const f = val(e); void run(async () => { await api(`${p}/enable`, { method: 'POST', body: { otp: f.otp }, scope }); setEnabled(true); setSetup(null); setMsg({ ok: true, text: t('تم تفعيل التحقق بخطوتين.', 'Two-factor authentication is on.') }); }); }}>
        <p className="small">{t('في تطبيق المصادقة اختر "إدخال مفتاح يدويًا" وأدخل هذا المفتاح، ثم اكتب الرمز المعروض:', 'In your authenticator app choose "enter a setup key" and type this key, then enter the code it shows:')}</p>
        <code className="mono ltr" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{setup.secret}</code>
        <label className="field">{t('الرمز (6 أرقام)', 'Code (6 digits)')}<input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" className="ltr" /></label>
        <div><button className="btn primary" disabled={busy}>{t('تأكيد وتفعيل', 'Confirm & enable')}</button></div></form>}
      {enabled && <form className="grid g2" onSubmit={(e) => { e.preventDefault(); const f = val(e); void run(async () => { await api(`${p}/disable`, { method: 'POST', body: { password: f.password, otp: f.otp }, scope }); setEnabled(false); setMsg({ ok: true, text: t('تم إيقاف التحقق بخطوتين.', 'Two-factor authentication is off.') }); }); }}>
        <p className="small" style={{ gridColumn: '1 / -1' }}>{t('التحقق بخطوتين مفعّل. لإيقافه أدخل كلمة المرور ورمزًا حاليًا:', 'Two-factor authentication is on. To turn it off enter your password and a current code:')}</p>
        <label className="field">{t('كلمة المرور', 'Password')}<input name="password" type="password" required autoComplete="current-password" /></label>
        <label className="field">{t('الرمز', 'Code')}<input name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" className="ltr" /></label>
        <div><button className="btn danger" disabled={busy}>{t('إيقاف', 'Turn off')}</button></div></form>}
    </section>
  );
}
