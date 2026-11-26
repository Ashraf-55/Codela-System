'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Dom { id: string; hostname: string; status: string; isPrimary: boolean; sslStatus: string; dns: { txtName: string; txtValue: string } }
export default function Domains() {
  const app = useApp(); const { t, locale } = useI18n(); const res = useAsync(() => api<Dom[]>('/tenant/domains'), []); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function call(path: string, method = 'POST', body: object = {}) { setMsg(null); try { const r = await api<any>(path, { method, body: method === 'DELETE' ? undefined : body }); if (r.data?.verified === false) setMsg({ ok: false, text: locale === 'ar' ? 'لم يتم العثور على سجل TXT بعد.' : 'TXT record not found yet.' }); else setMsg({ ok: true, text: t('saved') }); res.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('domains')}</h1>
      <div className="alert">{locale === 'ar' ? `عنوان موقعك الافتراضي: ${app.me.tenant.slug}.<النطاق الرئيسي>. الدومين المخصص لا يعمل إلا بعد التحقق من ملكيته، وتفعيل SSL يحتاج إعداد بنية تحتية (راجع DEPLOYMENT.md).` : `Your default address: ${app.me.tenant.slug}.<root-domain>. A custom domain only works after ownership verification; SSL provisioning needs infrastructure (see DEPLOYMENT.md).`}</div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <form className="card row" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); call('/tenant/domains', 'POST', { hostname: f.get('hostname') }); e.currentTarget.reset(); }}>
        <label className="field grow">{t('hostname')}<input name="hostname" className="ltr" placeholder="shop.example.com" required /></label><button className="btn primary" style={{ alignSelf: 'end' }}>{t('create')}</button></form>
      {res.data.data.map((d) => (
        <section key={d.id} className="card stack"><div className="row between"><b className="mono">{d.hostname}</b><div className="row"><span className={`badge ${d.status === 'verified' ? 'ok' : 'warn'}`}>{enumLabel(d.status, locale)}</span>{d.isPrimary && <span className="badge info">primary</span>}<span className="badge">{d.sslStatus}</span></div></div>
          {d.status !== 'verified' && <div className="small"><p>{t('dnsHelp')}</p><div className="mono">{d.dns.txtName}<br />{d.dns.txtValue}</div></div>}
          <div className="row">{d.status !== 'verified' && <button className="btn sm primary" onClick={() => call(`/tenant/domains/${d.id}/verify`)}>{t('verify')}</button>}
            {d.status === 'verified' && !d.isPrimary && <button className="btn sm" onClick={() => call(`/tenant/domains/${d.id}/primary`)}>{t('makePrimary')}</button>}<button className="btn sm danger" onClick={() => window.confirm(t('confirmDelete')) && call(`/tenant/domains/${d.id}`, 'DELETE')}>{t('delete')}</button></div></section>))}
      {!res.data.data.length && <div className="card muted">{t('empty')}</div>}
    </>
  );
}
