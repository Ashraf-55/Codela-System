'use client';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

type G = { key: string; value: number }[];
interface Row { key: string; label: string; total: number; won: number; lost: number; open: number; rate: number | null }

/** Estate: lead performance per source and per broker. Everything is counted on the server from real leads; the win rate is won / (won + lost), so still-open leads never dilute it. */
export default function LeadPerformance() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const res = useAsync(async () => {
    const g = (k: string) => api<G>(`/tenant/reports/${k}`).then((r) => r.data);
    const [src, srcW, srcL, brk, brkW, brkL] = await Promise.all(['leadsBySource', 'leadsWonBySource', 'leadsLostBySource', 'leadsByBroker', 'leadsWonByBroker', 'leadsLostByBroker'].map(g));
    const brokers = await api<{ id: string; data: Record<string, any> }[]>('/tenant/p/broker?pageSize=100').then((r) => r.data).catch(() => []);
    return { src, srcW, srcL, brk, brkW, brkL, brokers };
  }, []);
  const SRC: Record<string, string> = useMemo(() => ({ website: t('الموقع', 'Website'), referral: t('ترشيح', 'Referral'), walk_in: t('زيارة مباشرة', 'Walk-in'), call: t('اتصال', 'Call'), social: t('سوشيال', 'Social'), other: t('أخرى', 'Other'), unspecified: t('غير محدد', 'Unspecified') }), [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!app.can('leads.read')) return <div className="alert warn" role="alert">{t('لا تملك صلاحية العملاء المحتملين.', 'You cannot view leads.')}</div>;
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const d = res.data; const num = (g: G, k: string) => Number(g.find((x) => x.key === k)?.value ?? 0);
  const build = (all: G, won: G, lost: G, label: (k: string) => string): Row[] => all.map((x) => { const w = num(won, x.key), l = num(lost, x.key), total = Number(x.value); return { key: x.key, label: label(x.key), total, won: w, lost: l, open: total - w - l, rate: w + l ? Math.round((w / (w + l)) * 100) : null }; }).sort((a, b) => b.total - a.total);
  const bName = new Map(d.brokers.map((b) => [b.id, String(b.data.name ?? b.id)]));
  const bySource = build(d.src, d.srcW, d.srcL, (k) => SRC[k] ?? k); const byBroker = build(d.brk, d.brkW, d.brkL, (k) => (k === 'unspecified' ? t('بدون وسيط', 'Unassigned') : bName.get(k) ?? t('وسيط محذوف', 'Removed broker')));
  const total = bySource.reduce((a, r) => a + r.total, 0), won = bySource.reduce((a, r) => a + r.won, 0), lost = bySource.reduce((a, r) => a + r.lost, 0);
  const table = (title: string, rows: Row[], testid: string) => <section className="card stack"><h2 style={{ margin: 0, fontSize: '1.15rem' }}>{title}</h2>
    {!rows.length ? <p className="muted">{t('لا توجد بيانات بعد.', 'No data yet.')}</p> : <div className="table-wrap"><table data-testid={testid}><caption className="sr-only">{title}</caption><thead><tr><th scope="col">{t('الاسم', 'Name')}</th><th scope="col">{t('الإجمالي', 'Total')}</th><th scope="col">{t('مفتوحة', 'Open')}</th><th scope="col">{t('مكسوبة', 'Won')}</th><th scope="col">{t('خاسرة', 'Lost')}</th><th scope="col">{t('نسبة الكسب', 'Win rate')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><th scope="row" style={{ fontWeight: 600 }}>{r.label}</th><td>{r.total}</td><td>{r.open}</td><td>{r.won}</td><td>{r.lost}</td><td>{r.rate === null ? '—' : `${r.rate}%`}</td></tr>)}</tbody></table></div>}</section>;
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('أداء العملاء المحتملين', 'Lead performance')}</h1>
      <section className="grid g4" aria-label={t('ملخص', 'Summary')}>
        <div className="card kpi"><span className="muted small">{t('إجمالي العملاء', 'Total leads')}</span><b data-testid="lp-total">{total}</b></div>
        <div className="card kpi"><span className="muted small">{t('مكسوبة', 'Won')}</span><b data-testid="lp-won">{won}</b></div>
        <div className="card kpi"><span className="muted small">{t('خاسرة', 'Lost')}</span><b>{lost}</b></div>
        <div className="card kpi"><span className="muted small">{t('نسبة الكسب', 'Win rate')}</span><b data-testid="lp-rate">{won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : '—'}</b></div>
      </section>
      {table(t('حسب المصدر', 'By source'), bySource, 'lp-source')}
      {table(t('حسب الوسيط', 'By broker'), byBroker, 'lp-broker')}
    </>
  );
}
