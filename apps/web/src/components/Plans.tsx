import Link from 'next/link';
import { fmtMoney, t, type Locale } from '@/lib/i18n';

export interface Plan { id: string; tier: string; nameAr: string; nameEn: string; priceMonthly: number; priceAnnual: number; currency: string; trialDays: number; limits: Record<string, number | boolean> }
const LIMIT_LABELS: Record<string, { ar: string; en: string }> = { maxEmployees: { ar: 'موظفون', en: 'Employees' }, maxBranches: { ar: 'فروع', en: 'Branches' }, maxRecords: { ar: 'سجلات', en: 'Records' }, storageMb: { ar: 'تخزين (MB)', en: 'Storage (MB)' }, customDomain: { ar: 'دومين مخصص', en: 'Custom domain' }, advancedReports: { ar: 'تقارير متقدمة', en: 'Advanced reports' } };

export function PlanCards({ plans, locale, slug }: { plans: Plan[]; locale: Locale; slug: string }) {
  if (!plans.length) return <div className="alert">{t('empty', locale)}</div>;
  return (
    <div className="grid g3">
      {plans.map((p) => (
        <section key={p.id} className={`card tier${p.tier === 'professional' ? ' featured' : ''}`} aria-labelledby={`pl-${p.id}`}>
          <h3 id={`pl-${p.id}`}>{locale === 'ar' ? p.nameAr : p.nameEn}</h3>
          <div className="price">{fmtMoney(p.priceMonthly, p.currency, locale)} <span className="muted small">{t('perMonth', locale)}</span></div>
          <div className="muted small">{fmtMoney(p.priceAnnual, p.currency, locale)} {t('perYear', locale)}</div>
          <p><span className="badge info">{t('freeTrial', locale)}: {p.trialDays} {t('days', locale)}</span></p>
          <ul className="ticks">{Object.entries(p.limits).map(([k, v]) => (
            <li key={k}>{LIMIT_LABELS[k]?.[locale] ?? k}{typeof v === 'number' ? `: ${new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(v)}` : v ? '' : ` — ${t('no', locale)}`}</li>))}</ul>
          <Link className="btn primary block" href={`/register?product=${slug}&plan=${p.tier}`}>{t('register', locale)}</Link>
        </section>
      ))}
    </div>
  );
}
