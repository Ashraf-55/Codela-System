'use client';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/i18n';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';
import { PRODUCT_NAMES } from '@/lib/content';

interface An { tenants: { total: number; active: number; suspended: number }; subscriptions: Record<string, number>; revenue: Record<string, { mrr: number; arr: number }>; byProduct: Record<string, Record<string, { mrr: number; arr: number; count: number }>>; byPlan: Record<string, { count: number }>; simulated: boolean }
export default function Analytics() {
  const { t, locale } = useI18n(); const res = useAsync(() => api<An>('/platform/analytics', { scope: 'platform' }), []);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const d = res.data.data; const cur = Object.keys(d.revenue);
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('analytics')}</h1>{d.simulated && <div className="alert warn" role="note">{t('simulatedNote')}</div>}
      <div className="grid g4">
        <div className="card kpi"><span>{t('tenants')}</span><b>{d.tenants.total}</b><span className="small">{d.tenants.active} active · {d.tenants.suspended} suspended</span></div>
        {Object.entries(d.subscriptions).map(([k, v]) => <div key={k} className="card kpi"><span>{k}</span><b>{v}</b></div>)}
        {cur.map((c) => <div key={c} className="card kpi"><span>MRR ({c})</span><b className="mono">{fmtMoney(d.revenue[c].mrr, c, locale)}</b><span className="small">ARR {fmtMoney(d.revenue[c].arr, c, locale)}</span></div>)}
      </div>
      <section className="card stack"><h3>{t('products')}</h3>{!Object.keys(d.byProduct).length ? <p className="muted">—</p> : <div className="table-wrap"><table><thead><tr><th>{t('products')}</th><th>#</th><th>MRR</th></tr></thead><tbody>{Object.entries(d.byProduct).flatMap(([p, byCur]) => Object.entries(byCur).map(([c, v]) => <tr key={p + c}><td>{PRODUCT_NAMES[p]?.[locale] ?? p}</td><td>{v.count}</td><td className="mono">{fmtMoney(v.mrr, c, locale)}</td></tr>))}</tbody></table></div>}</section>
    </>
  );
}
