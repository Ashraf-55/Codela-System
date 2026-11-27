'use client';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n, confirmDialog } from '@/components/Providers';

interface Role { name: string; labelEn: string; labelAr: string; custom: boolean; permissions?: string[] }
interface Catalog { modules: { module: string; labelEn: string; labelAr: string; actions: string[] }[]; core: string[] }
const ACTION_AR: Record<string, string> = { read: 'عرض', create: 'إضافة', update: 'تعديل', delete: 'حذف', approve: 'اعتماد', export: 'تصدير' };
const CORE_AR: Record<string, string> = { 'reports.read': 'التقارير', 'search.use': 'البحث', 'audit.read': 'سجل العمليات', 'employees.read': 'عرض الموظفين' };

/** Custom roles: the owner picks, per module, which actions a job role may perform. The API enforces them on every request. */
export default function RolesPage() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const roles = useAsync(() => api<Role[]>('/tenant/roles'), []); const cat = useAsync(() => api<Catalog>('/tenant/permission-catalog'), []);
  const [editing, setEditing] = useState<string | null>(null); const [name, setName] = useState(''); const [perms, setPerms] = useState<Set<string>>(new Set()); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setMsg(null); }, [editing]);
  if (!app.can('roles.manage')) return <div className="alert warn" role="alert">{t('هذه الصفحة لمالك النشاط فقط.', 'This page is for the business owner only.')}</div>;
  if (roles.error) return <ErrorBox error={roles.error} retry={roles.reload} />; if (cat.error) return <ErrorBox error={cat.error} retry={cat.reload} />; if (!roles.data || !cat.data) return <Loading />;
  const catalog = cat.data.data; const custom = roles.data.data.filter((r) => r.custom); const builtin = roles.data.data.filter((r) => !r.custom);
  const toggle = (p: string) => setPerms((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const startNew = () => { setEditing('__new'); setName(''); setPerms(new Set(['reports.read'])); };
  const edit = (r: Role) => { setEditing(r.name); setName(r.name); setPerms(new Set(r.permissions ?? [])); };
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body = { permissions: [...perms] };
      if (editing === '__new') await api('/tenant/roles', { method: 'POST', body: { name, ...body } }); else await api(`/tenant/roles/${editing}`, { method: 'PUT', body });
      setMsg({ ok: true, text: t('تم الحفظ', 'Saved') }); setEditing(null); roles.reload();
    } catch (e) { const a = e as ApiError; setMsg({ ok: false, text: a.message + (a.fields ? ' — ' + Object.entries(a.fields).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ') : '') }); } finally { setBusy(false); }
  }
  async function remove(r: Role) { if (!(await confirmDialog(t(`حذف الدور ${r.name}؟`, `Delete role ${r.name}?`), { danger: true }))) return; setMsg(null); try { await api(`/tenant/roles/${r.name}`, { method: 'DELETE' }); roles.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('الأدوار والصلاحيات', 'Roles & permissions')}</h1><button className="btn primary" onClick={startNew}>{t('دور جديد', 'New role')}</button></div>
      <p className="hint">{t('أنشئ دورًا وظيفيًا (مثل: مسؤول استقبال) وحدّد ماذا يستطيع أن يفعل في كل قسم. الصلاحيات تُطبَّق من السيرفر فورًا، وليس فقط بإخفاء القوائم. ثم عيّن الدور لموظف من صفحة الفريق.', 'Create a job role (e.g. front desk) and choose what it may do in each module. Permissions are enforced by the server immediately, not just by hiding menus. Then assign the role to staff from the Team page.')}</p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <section className="card stack"><h3>{t('أدوار مخصصة', 'Custom roles')}</h3>
        {!custom.length ? <p className="muted">{t('لا توجد أدوار مخصصة بعد.', 'No custom roles yet.')}</p> : <div className="table-wrap"><table><thead><tr><th scope="col">{t('الدور', 'Role')}</th><th scope="col">{t('عدد الصلاحيات', 'Permissions')}</th><th /></tr></thead><tbody>{custom.map((r) => (
          <tr key={r.name}><td><b>{r.name}</b></td><td>{r.permissions?.length ?? 0}</td><td className="row"><button className="btn sm" onClick={() => edit(r)}>{t('تعديل', 'Edit')}</button><button className="btn sm danger" onClick={() => remove(r)}>{t('حذف', 'Delete')}</button></td></tr>))}</tbody></table></div>}
        <p className="small muted">{t('أدوار جاهزة: ', 'Built-in roles: ')}{builtin.map((r) => (locale === 'ar' ? r.labelAr : r.labelEn)).join('، ')}</p></section>
      {editing && <section className="card stack" aria-label={t('محرر الدور', 'Role editor')}>
        <h3>{editing === '__new' ? t('دور جديد', 'New role') : `${t('تعديل', 'Edit')} ${editing}`}</h3>
        {editing === '__new' && <label className="field">{t('اسم الدور (حروف إنجليزية صغيرة و _)', 'Role name (lowercase letters and _)')}<input className="ltr" value={name} maxLength={30} pattern="[a-z][a-z_]{2,29}" onChange={(e) => setName(e.target.value.toLowerCase())} required /></label>}
        <div className="table-wrap"><table><thead><tr><th scope="col">{t('القسم', 'Module')}</th>{['read', 'create', 'update', 'delete', 'approve', 'export'].map((a) => <th key={a} scope="col">{locale === 'ar' ? ACTION_AR[a] : a}</th>)}</tr></thead>
          <tbody>{catalog.modules.map((m) => <tr key={m.module}><th scope="row">{locale === 'ar' ? m.labelAr : m.labelEn}</th>{['read', 'create', 'update', 'delete', 'approve', 'export'].map((a) => <td key={a}>{m.actions.includes(a) ? <input type="checkbox" aria-label={`${m.module} ${a}`} checked={perms.has(`${m.module}.${a}`)} onChange={() => toggle(`${m.module}.${a}`)} /> : <span aria-hidden="true" className="muted">—</span>}</td>)}</tr>)}</tbody></table></div>
        <div className="row" style={{ flexWrap: 'wrap' }}>{catalog.core.map((p) => <label key={p} className="row"><input type="checkbox" checked={perms.has(p)} onChange={() => toggle(p)} />{locale === 'ar' ? CORE_AR[p] ?? p : p}</label>)}</div>
        <div className="row"><button className="btn primary" disabled={busy || perms.size === 0 || (editing === '__new' && name.length < 3)} onClick={save}>{busy ? '…' : t('حفظ', 'Save')}</button><button className="btn" onClick={() => setEditing(null)}>{t('إلغاء', 'Cancel')}</button></div></section>}
    </>
  );
}
