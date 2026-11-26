'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

/** Fleet owner: give a driver a login for the driver portal (/driver). The account can do nothing else. */
export default function DriverAccounts() {
  const app = useApp(); const t = (ar: string, en: string) => (app.locale === 'ar' ? ar : en); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false); const [open, setOpen] = useState('');
  const res = useAsync<{ data: Rec[] }>(() => api<Rec[]>('/tenant/p/driver?pageSize=100'), []);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  async function create(e: React.FormEvent<HTMLFormElement>, d: Rec) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setMsg(null);
    try { await api('/tenant/fleet/driver-accounts', { method: 'POST', body: { driverId: d.id, email: String(f.get('email') ?? '').trim(), password: String(f.get('password') ?? '') } }); setMsg({ ok: true, text: t('تم إنشاء حساب المندوب. يدخل من صفحة تسجيل الدخول ويُحوَّل لواجهة المندوب.', 'Driver login created. They sign in on the normal login page and land in the driver portal.') }); setOpen(''); res.reload(); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  return (
    <div className="stack"><h1>{t('حسابات المناديب', 'Driver logins')}</h1>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {res.data.data.length === 0 && <div className="card"><p className="muted">{t('أضف مندوبًا أولًا من شاشة المناديب.', 'Add a driver first from the Drivers screen.')}</p></div>}
      {res.data.data.map((d) => (
        <div key={d.id} className="card stack"><div className="row between"><b>{String(d.data.name)}</b>{d.data.userId ? <span className="badge ok">{t('لديه حساب', 'Has a login')}</span> : <button className="btn sm" onClick={() => setOpen(open === d.id ? '' : d.id)}>{t('إنشاء حساب', 'Create login')}</button>}</div>
          {open === d.id && <form className="stack" onSubmit={(e) => create(e, d)}><label className="field">{t('البريد الإلكتروني', 'E-mail')} *<input name="email" type="email" required className="ltr" autoComplete="off" /></label><label className="field">{t('كلمة المرور (10 أحرف على الأقل)', 'Password (min 10 characters)')} *<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label><div><button className="btn primary" disabled={busy}>{busy ? '…' : t('إنشاء', 'Create')}</button></div></form>}
        </div>))}
    </div>
  );
}
