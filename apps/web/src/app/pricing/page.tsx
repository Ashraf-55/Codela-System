import Link from 'next/link';
import { Page, SiteFooter, SiteHeader } from '@/components/Site';
import { PlanCards, type Plan } from '@/components/Plans';
import { PRODUCT_NAMES } from '@/lib/content';
import { getLocale } from '@/lib/locale';
import { serverApi } from '@/lib/server-api';
import { t } from '@/lib/i18n';

export const metadata = { title: 'Pricing' };
export default async function Pricing(props: { searchParams: Promise<{ p?: string }> }) {
  const searchParams = await props.searchParams; const locale = await getLocale(); const slug = searchParams.p && PRODUCT_NAMES[searchParams.p] ? searchParams.p : 'medical';
  const plans = await serverApi<Plan[]>(`/public/plans?productSlug=${slug}`);
  return (
    <><SiteHeader locale={locale} /><Page><section className="section"><div className="container stack"><h1>{t('pricing', locale)}</h1>
      <div className="tabs" role="tablist">{Object.keys(PRODUCT_NAMES).map((s) => <Link key={s} role="tab" aria-selected={s === slug} href={`/pricing?p=${s}`} className="btn sm" style={s === slug ? { background: 'var(--color-primary)', color: 'var(--color-on-primary)' } : {}}>{PRODUCT_NAMES[s][locale]}</Link>)}</div>
      <PlanCards plans={plans.data ?? []} locale={locale} slug={slug} /></div></section></Page><SiteFooter locale={locale} /></>
  );
}
