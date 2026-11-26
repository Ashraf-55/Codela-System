'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

type List = { data: Rec[] };
const STATUSES = ['present', 'late', 'absent', 'leave'];
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/** HR: daily attendance sheet (check-in / check-out / status per employee) and a monthly summary with worked hours computed by the server. */
export default function Attendance() {
  const app = useApp(); const t = (ar: string, en: string) => (app.locale === 'ar' ? ar : en); const def = app.entity('attendance');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [tab, setTab] = useState<'day' | 'month'>('day'); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState('');
  const emps = useAsync<List>(() => api<Rec[]>('/tenant/p/employee?status=active&pageSize=200'), []);
  const rows = useAsync<List>(() => api<Rec[]>('/tenant/p/attendance?pageSize=500&sort=date&dir=desc'), []);
  if (!def) return <div className="card"><p className="muted">{t('لا تملك صلاحية الحضور.', 'You do not have access to attendance.')}</p></div>;
  if (emps.error) return <ErrorBox error={emps.error} retry={emps.reload} />; if (rows.error) return <ErrorBox error={rows.error} retry={rows.reload} />; if (!emps.data || !rows.data) return <Loading />;
  const today = new Map(rows.data.data.filter((r) => r.data.date === date).map((r) => [String(r.data.employeeId), r])); const month = date.slice(0, 7);

  async function save(e: React.FormEvent<HTMLFormElement>, empId: string) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const status = String(f.get('status')); const away = status === 'absent' || status === 'leave'; setBusy(empId); setMsg(null);
    const body: Record<string, unknown> = { employeeId: empId, date, status, checkIn: away ? undefined : String(f.get('in') || '') || undefined, checkOut: away ? undefined : String(f.get('out') || '') || undefined };
    const ex = today.get(empId);
    try { if (ex) await api(`/tenant/p/attendance/${ex.id}`, { method: 'PATCH', body }); else await api('/tenant/p/attendance', { method: 'POST', body }); setMsg({ ok: true, text: t('تم الحفظ', 'Saved') }); rows.reload(); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(''); }
  }
  const sum = new Map<string, { present: number; late: number; absent: number; leave: number; minutes: number }>();
  for (const r of rows.data.data.filter((x) => String(x.data.date).startsWith(month))) { const k = String(r.data.employeeId); const c = sum.get(k) ?? { present: 0, late: 0, absent: 0, leave: 0, minutes: 0 }; c[String(r.data.status) as 'present'] += 1; c.minutes += Number(r.data.minutes ?? 0); sum.set(k, c); }

  return (
    <div className="stack"><h1>{t('الحضور والانصراف', 'Attendance')}</h1>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field">{t('التاريخ', 'Date')}<input type="date" className="ltr" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="row" role="tablist"><button role="tab" aria-selected={tab === 'day'} className={`btn${tab === 'day' ? ' primary' : ''}`} onClick={() => setTab('day')}>{t('اليوم', 'Day sheet')}</button><button role="tab" aria-selected={tab === 'month'} className={`btn${tab === 'month' ? ' primary' : ''}`} onClick={() => setTab('month')}>{t('ملخص الشهر', 'Month summary')}</button></div></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {emps.data.data.length === 0 && <div className="card"><p className="muted">{t('أضف موظفين أولًا من شاشة الموظفين.', 'Add employees first from the Employees screen.')}</p></div>}
      {tab === 'day' ? (
        <div className="table-wrap"><table><thead><tr><th>{t('الموظف', 'Employee')}</th><th>{t('حضور', 'In')}</th><th>{t('انصراف', 'Out')}</th><th>{t('الحالة', 'Status')}</th><th>{t('الساعات', 'Hours')}</th><th /></tr></thead>
          <tbody>{emps.data.data.map((e) => { const r = today.get(e.id); return (
            <tr key={`${e.id}-${r?.id ?? 'new'}-${date}`}><td><b>{String(e.data.name)}</b><br /><span className="muted small">{String(e.data.position ?? '')}</span></td>
              <td colSpan={4}><form className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }} onSubmit={(ev) => save(ev, e.id)}>
                <input name="in" type="time" className="ltr" aria-label={t('حضور', 'In')} defaultValue={String(r?.data.checkIn ?? '')} /><input name="out" type="time" className="ltr" aria-label={t('انصراف', 'Out')} defaultValue={String(r?.data.checkOut ?? '')} />
                <select name="status" aria-label={t('الحالة', 'Status')} defaultValue={String(r?.data.status ?? 'present')}>{STATUSES.map((s) => <option key={s} value={s}>{enumLabel(s, app.locale)}</option>)}</select>
                <span className="mono small">{r ? hm(Number(r.data.minutes ?? 0)) : '—'}</span>{def.canCreate || def.canUpdate ? <button className="btn sm primary" disabled={busy === e.id}>{busy === e.id ? '…' : t('حفظ', 'Save')}</button> : null}</form></td><td /></tr>); })}</tbody></table></div>
      ) : (
        <div className="table-wrap"><table><thead><tr><th>{t('الموظف', 'Employee')}</th>{STATUSES.map((s) => <th key={s}>{enumLabel(s, app.locale)}</th>)}<th>{t('إجمالي الساعات', 'Total hours')}</th></tr></thead>
          <tbody>{emps.data.data.map((e) => { const c = sum.get(e.id); return <tr key={e.id}><td>{String(e.data.name)}</td>{STATUSES.map((s) => <td key={s} className="mono">{c ? c[s as 'present'] : 0}</td>)}<td className="mono">{hm(c?.minutes ?? 0)}</td></tr>; })}</tbody></table></div>)}
    </div>
  );
}
