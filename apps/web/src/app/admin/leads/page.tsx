'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

const STAGES = ['new', 'contacted', 'demo_scheduled', 'proposal', 'won', 'lost'];
export default function Leads() {
  const { t, locale } = useI18n(); const [stage, setStage] = useState(''); const [msg, setMsg] = useState('');
  const pipe = useAsync(() => api<{ stages: Record<string, number>; total: number; conversionRate: number | null }>('/platform/leads/pipeline', { scope: 'platform' }), []);
  const res = useAsync(() => api<any[]>(`/platform/leads?pageSize=50${stage ? `&stage=${stage}` : ''}`, { scope: 'platform' }), [stage]);
  async function move(id: string, s: string) { setMsg(''); try { await api(`/platform/leads/${id}`, { method: 'PATCH', scope: 'platform', body: { stage: s } }); res.reload(); pipe.reload(); } catch (e) { setMsg((e as ApiError).message); } }
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />;
  return (
    <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('leads')}</h1>
      {pipe.data && <div className="grid g4">{STAGES.map((s) => <button key={s} className="card kpi" style={{ textAlign: 'start', cursor: 'pointer' }} onClick={() => setStage(stage === s ? '' : s)} aria-pressed={stage === s}><span>{enumLabel(s, locale)}</span><b>{pipe.data!.data.stages[s]}</b></button>)}
        <div className="card kpi"><span>Conversion</span><b>{pipe.data.data.conversionRate === null ? '—' : `${Math.round(pipe.data.data.conversionRate * 100)}%`}</b></div></div>}
      {msg && <div className="alert error" role="alert">{msg}</div>}
      {!res.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>{t('name')}</th><th>{t('phone')}</th><th>{t('email')}</th><th>{t('products')}</th><th>{t('stage')}</th></tr></thead><tbody>{res.data.data.map((l) => (
        <tr key={l.id}><td><b>{l.name}</b><div className="muted small">{l.company}</div></td><td className="mono">{l.phone}</td><td className="mono">{l.email}</td><td>{l.productSlug}</td>
          <td><select value={l.stage} onChange={(e) => move(l.id, e.target.value)} aria-label={t('stage')} style={{ width: 'auto' }}>{STAGES.map((s) => <option key={s} value={s}>{enumLabel(s, locale)}</option>)}</select></td></tr>))}</tbody></table></div>}</>
  );
}
