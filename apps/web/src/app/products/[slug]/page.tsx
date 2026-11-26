import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PRODUCT_THEMES, themeToCssVars, type ProductSlug } from '@codela/design';
import { Page, SiteFooter, SiteHeader } from '@/components/Site';
import { PlanCards, type Plan } from '@/components/Plans';
import { CONTENT, PRODUCT_NAMES } from '@/lib/content';
import { getLocale } from '@/lib/locale';
import { serverApi } from '@/lib/server-api';
import { t } from '@/lib/i18n';

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params; const n = PRODUCT_NAMES[slug]; return n ? { title: n.en, description: CONTENT[slug].tagline.en } : {};
}
export default async function ProductPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params; const c = CONTENT[slug]; if (!c || !(slug in PRODUCT_THEMES)) notFound();
  const locale = await getLocale(); const plans = await serverApi<Plan[]>(`/public/plans?productSlug=${slug}`);
  return (
    <>
      <style>{themeToCssVars(slug as ProductSlug)}</style>
      <SiteHeader locale={locale} />
      <Page>
        <section className="hero" style={{ background: `color-mix(in srgb, ${PRODUCT_THEMES[slug as ProductSlug].primary} 70%, #0b1b2b)` }}><div className="container stack">
          <h1>{PRODUCT_NAMES[slug][locale]}</h1><p>{c.tagline[locale]}</p><div className="row"><Link className="btn signal" href={`/register?product=${slug}`}>{t('register', locale)}</Link></div></div></section>
        <section className="section"><div className="container grid g2"><div className="card"><h3>{locale === 'ar' ? 'لمن هذا المنتج؟' : 'Who is it for?'}</h3><p>{c.audience[locale]}</p></div><div className="card"><h3>{locale === 'ar' ? 'المشكلة التي نحلها' : 'The problem we solve'}</h3><p>{c.problems[locale]}</p></div></div></section>
        <section className="section alt"><div className="container stack"><h2>{t('features', locale)}</h2><div className="grid g3">{c.features.map((f, i) => <div key={i} className="card"><p style={{ margin: 0 }}>{f[locale]}</p></div>)}</div></div></section>
        <section className="section"><div className="container stack"><h2>{t('pricing', locale)}</h2><PlanCards plans={plans.data ?? []} locale={locale} slug={slug} />{!plans.ok && <div className="alert warn">{t('error', locale)}</div>}</div></section>
        <section className="section alt"><div className="container stack"><h2>{t('faq', locale)}</h2>{c.faq.map((x, i) => <details key={i} className="card flat"><summary><b>{x.q[locale]}</b></summary><p>{x.a[locale]}</p></details>)}</div></section>
      </Page>
      <SiteFooter locale={locale} />
    </>
  );
}
