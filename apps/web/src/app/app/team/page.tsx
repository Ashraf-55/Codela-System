'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Member { id: string; name: string; email: string; role: string; status: string }
interface RoleOpt { name: string; labelEn: string; labelAr: string }
export default function Team() {
  const app = useApp(); const { t, locale } = useI18n(); const res = useAsync(() => api<Member[]>('/tenant/employees'), []); const roleOpts = useAsync(() => api<RoleOpt[]>('/tenant/roles').catch(() => ({ data: [{ name: 'employee', labelEn: 'Employee', labelAr: 'موظف' }, { name: 'manager', labelEn: 'Manager', labelAr: 'مدير' }] as RoleOpt[] })), []); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function create(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; setMsg(null);
    try { await api('/tenant/employees', { method: 'POST', body: f }); form.reset(); setMsg({ ok: true, text: t('saved') }); res.reload(); } catch (x) { const a = x as ApiError; setMsg({ ok: false, text: a.message + (a.fields ? ' — ' + Object.entries(a.fields).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ') : '') }); } }
  async function setRole(m: Member, role: string) { setMsg(null); try { await api(`/tenant/employees/${m.id}/role`, { method: 'PUT', body: { role } }); setMsg({ ok: true, text: t('saved') }); res.reload(); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } }
  async function toggle(m: Member) { setMsg(null); try { await api(`/tenant/employees/${m.id}`, { method: 'PATCH', body: { status: m.status === 'active' ? 'suspended' : 'active' } }); res.reload(); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } }
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const canManage = app.can('employees.manage');
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('team')}</h1>{msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <div className="table-wrap"><table><thead><tr><th>{t('name')}</th><th>{t('email')}</th><th>{t('role')}</th><th>{t('status')}</th><th /></tr></thead><tbody>{res.data.data.map((m) => (
        <tr key={m.id}><td>{m.name}</td><td className="mono">{m.email}</td><td>{app.can('roles.manage') && m.role !== 'owner' && m.role !== 'driver' ? <select aria-label={`${t('role')} — ${m.name}`} value={m.role} onChange={(e) => setRole(m, e.target.value)} style={{ width: 'auto' }}>{(roleOpts.data?.data ?? []).map((r) => <option key={r.name} value={r.name}>{locale === 'ar' ? r.labelAr : r.labelEn}</option>)}</select> : <span className="badge">{m.role}</span>}</td><td><span className={`badge ${m.status === 'active' ? 'ok' : 'bad'}`}>{enumLabel(m.status, locale)}</span></td>
          <td>{canManage && m.role !== 'owner' && <button className="btn sm" onClick={() => toggle(m)}>{m.status === 'active' ? t('suspend') : t('reactivate')}</button>}</td></tr>))}</tbody></table></div>
      {canManage && <form className="card stack" onSubmit={create}><h3>{t('addMember')}</h3><div className="grid g2">
        <label className="field">{t('name')}<input name="name" required /></label><label className="field">{t('email')}<input name="email" type="email" required className="ltr" /></label>
        <label className="field">{t('password')}<input name="password" type="password" required autoComplete="new-password" className="ltr" /><span className="hint">{t('passwordHint')}</span></label>
        <label className="field">{t('role')}<select name="role" defaultValue="employee">{(roleOpts.data?.data ?? []).map((r) => <option key={r.name} value={r.name}>{locale === 'ar' ? r.labelAr : r.labelEn}</option>)}</select></label></div><div><button className="btn primary">{t('create')}</button></div></form>}
    </>
  );
}
