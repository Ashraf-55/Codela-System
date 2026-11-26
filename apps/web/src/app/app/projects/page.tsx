'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { enumLabel, fieldLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

type List = { data: Rec[] };
const CATS = ['labor', 'material', 'subcontract', 'equipment', 'other'];
const safe = (p: Promise<{ data: Rec[] }>): Promise<List> => p.then((r) => ({ data: r.data })).catch(() => ({ data: [] })); // a role without access to a section simply sees it empty

/** Contractor's project cockpit: progress, budget vs actual by category, contract, progress claims and tasks of one project. */
export default function Projects() {
  const app = useApp(); const t = (ar: string, en: string) => (app.locale === 'ar' ? ar : en); const [id, setId] = useState('');
  const list = useAsync<List>(() => api<Rec[]>('/tenant/p/project?pageSize=100&sort=createdAt&dir=desc'), []);
  const det = useAsync<{ budget: List; expenses: List; claims: List; contracts: List; tasks: List }>(async () => id ? ({
    budget: await safe(api<Rec[]>(`/tenant/p/budgetLine?projectId=${id}&pageSize=100`)), expenses: await safe(api<Rec[]>(`/tenant/p/expense?projectId=${id}&pageSize=200`)),
    claims: await safe(api<Rec[]>(`/tenant/p/progressClaim?projectId=${id}&pageSize=100`)), contracts: await safe(api<Rec[]>(`/tenant/p/contract?projectId=${id}&pageSize=20`)), tasks: await safe(api<Rec[]>(`/tenant/p/task?projectId=${id}&pageSize=200`)) }) : ({ budget: { data: [] }, expenses: { data: [] }, claims: { data: [] }, contracts: { data: [] }, tasks: { data: [] } }), [id]);
  if (list.error) return <ErrorBox error={list.error} retry={list.reload} />; if (!list.data) return <Loading />;
  const p = list.data.data.find((x) => x.id === id); const d = det.data;
  const byCat = (rows: Rec[]) => Object.fromEntries(CATS.map((c) => [c, rows.filter((r) => r.data.category === c).reduce((a, r) => a + Number(r.data.amount ?? 0), 0)]));
  const bud = d ? byCat(d.budget.data) : {}; const act = d ? byCat(d.expenses.data) : {};
  const done = d ? d.tasks.data.filter((x) => x.data.status === 'done').length : 0;

  return (
    <div className="stack"><h1>{t('لوحة المشاريع', 'Project cockpit')}</h1>
      <label className="field" style={{ maxWidth: 380 }}>{t('اختر مشروعًا', 'Choose a project')}<select value={id} onChange={(e) => setId(e.target.value)}><option value="">—</option>{list.data.data.map((x) => <option key={x.id} value={x.id}>{x.code} · {String(x.data.name)}</option>)}</select></label>
      {!p && <div className="grid g3">{list.data.data.slice(0, 12).map((x) => (
        <button key={x.id} className="card stack" style={{ textAlign: 'start', cursor: 'pointer' }} onClick={() => setId(x.id)}><b>{String(x.data.name)}</b><span className="muted small">{enumLabel(String(x.data.status), app.locale)}</span>
          <div role="progressbar" aria-valuenow={Number(x.data.progressPct ?? 0)} aria-valuemin={0} aria-valuemax={100} style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)' }}><div style={{ width: `${Number(x.data.progressPct ?? 0)}%`, height: '100%', borderRadius: 4, background: x.data.overBudget ? 'var(--color-danger, #c0392b)' : 'var(--color-primary)' }} /></div>
          <span className="small">{Number(x.data.progressPct ?? 0)}% · {app.money(Number(x.data.actualCost ?? 0))} / {app.money(Number(x.data.budget ?? 0))}</span></button>))}</div>}
      {p && (det.error ? <ErrorBox error={det.error} retry={det.reload} /> : !d ? <Loading /> : (
        <div className="stack">
          <div className="grid g3">
            <div className="card"><span className="muted small">{t('نسبة الإنجاز', 'Progress')}</span><br /><b style={{ fontSize: '1.4rem' }}>{Number(p.data.progressPct ?? 0)}%</b><br /><span className="small muted">{done}/{d.tasks.data.length} {t('مهام منجزة', 'tasks done')}</span></div>
            <div className="card"><span className="muted small">{t('الميزانية', 'Budget')}</span><br /><b className="mono">{app.money(Number(p.data.budget ?? 0))}</b></div>
            <div className={`card${p.data.overBudget ? ' alert error' : ''}`}><span className="muted small">{t('التكلفة الفعلية', 'Actual cost')}</span><br /><b className="mono">{app.money(Number(p.data.actualCost ?? 0))}</b>{p.data.overBudget ? <><br /><span className="badge bad">{t('تجاوز الميزانية', 'Over budget')}</span></> : null}</div>
          </div>
          <div className="table-wrap"><table><thead><tr><th>{t('البند', 'Category')}</th><th>{t('المخطط', 'Planned')}</th><th>{t('الفعلي', 'Actual')}</th><th>{t('الفرق', 'Variance')}</th></tr></thead>
            <tbody>{CATS.map((c) => { const v = (bud[c] ?? 0) - (act[c] ?? 0); return <tr key={c}><td>{enumLabel(c, app.locale)}</td><td className="mono">{app.money(bud[c] ?? 0)}</td><td className="mono">{app.money(act[c] ?? 0)}</td><td className="mono" style={{ color: v < 0 ? 'var(--color-danger, #c0392b)' : undefined }}>{app.money(v)}</td></tr>; })}</tbody></table></div>
          <h3>{t('العقد', 'Contract')}</h3>
          {d.contracts.data.length === 0 ? <p className="muted small">{t('لا يوجد عقد.', 'No contract.')}</p> : d.contracts.data.map((c) => <div key={c.id} className="row between card"><span><b className="mono">{c.code}</b> · {String(c.data.title)}</span><span><b className="mono">{app.money(Number(c.data.value))}</b> <span className="badge info">{enumLabel(String(c.data.status), app.locale)}</span></span></div>)}
          <h3>{t('المستخلصات', 'Progress claims')}</h3>
          {d.claims.data.length === 0 ? <p className="muted small">{t('لا توجد مستخلصات.', 'No claims yet.')}</p> : (
            <div className="table-wrap"><table><thead><tr><th>#</th><th>{fieldLabel('periodTo', app.locale)}</th><th>{t('الإجمالي التراكمي', 'Cumulative')}</th><th>{t('قيمة المستخلص', 'Gross')}</th><th>{t('محتجز', 'Retention')}</th><th>{t('الصافي', 'Net')}</th><th>{t('الحالة', 'Status')}</th></tr></thead>
              <tbody>{d.claims.data.map((c) => <tr key={c.id}><td className="mono">{c.code}</td><td>{String(c.data.periodTo)}</td><td className="mono">{app.money(Number(c.data.cumulativeValue))}</td><td className="mono">{app.money(Number(c.data.grossAmount))}</td><td className="mono">{app.money(Number(c.data.retentionAmount))}</td><td className="mono">{app.money(Number(c.data.netAmount))}</td><td><span className="badge info">{enumLabel(String(c.data.status), app.locale)}</span></td></tr>)}</tbody></table></div>)}
          <button className="btn sm" style={{ alignSelf: 'start' }} onClick={() => setId('')}>{t('كل المشاريع', 'All projects')}</button>
        </div>))}
    </div>
  );
}
