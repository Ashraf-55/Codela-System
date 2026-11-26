import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { contrastRatio } from '@codela/design';
import { GenericSection, SiteFooter, type Hours, type SiteContent } from '@/components/SiteSections';
import { fontsHref } from '@/lib/fonts';
import { ROOT_DOMAIN, requestHost, serverApi } from '@/lib/server-api';

/** An extra page of a tenant's site, served at its own SEO-friendly address: /sites/<tenant>/<page-slug> (or /<page-slug> on a custom domain). */
interface PageDoc { slug: string; title: string; enabled?: boolean; seo?: { title?: string; description?: string; noindex?: boolean }; sections: { type: string; enabled: boolean; content: SiteContent }[] }
interface Site { templateKey: string; brand: Record<string, any>; sections: unknown[]; seo?: { ogImage?: string | null }; hours?: Hours | null; theme?: { font?: string; layout?: string; header?: string; footer?: string }; pages?: PageDoc[]; locale: 'ar' | 'en'; currency: string; productSlug: string }
export const dynamic = 'force-dynamic';
const SAFE = /^#[0-9a-fA-F]{6}$/;
const host = async (slug: string) => (slug === '_host' ? await requestHost() : `${slug}.${ROOT_DOMAIN}`);
const onColor = (bg: string) => (contrastRatio('#ffffff', bg) >= contrastRatio('#0b1b2b', bg) ? '#ffffff' : '#0b1b2b');
async function load(slug: string, page: string) {
  const r = await serverApi<Site>('/public/site', await host(slug)); if (!r.data) return null;
  const doc = (r.data.pages ?? []).find((p) => p.slug === page); return doc ? { site: r.data, doc } : null;
}

export async function generateMetadata(props: { params: Promise<{ slug: string; page: string }> }): Promise<Metadata> {
  const { slug, page } = await props.params; const d = await load(slug, page); if (!d) return { title: 'Page not found' };
  const title = d.doc.seo?.title || `${d.doc.title} — ${d.site.brand.name}`; const description = d.doc.seo?.description || d.site.brand.description || undefined;
  return { title: { absolute: title }, description, robots: d.doc.seo?.noindex ? { index: false, follow: false } : undefined, openGraph: { title, description, type: 'website', images: d.site.seo?.ogImage ? [d.site.seo.ogImage] : undefined } };
}

export default async function SitePage(props: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page } = await props.params; const d = await load(slug, page); if (!d) notFound();
  const { site: s, doc } = d!; const brand = s.brand; const locale = s.locale === 'en' ? 'en' : 'ar'; const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const primary = SAFE.test(brand.primaryColor ?? '') ? brand.primaryColor : '#0f766e'; const accent = SAFE.test(brand.secondaryColor ?? '') ? brand.secondaryColor : '#b45309';
  const base = slug === '_host' ? '' : `/sites/${slug}`; const sections = doc.sections.filter((x) => x.enabled);
  return (
    <div className={`tsite tpl-${s.templateKey}`} data-product={s.productSlug} data-font={s.theme?.font ?? 'default'} data-layout={s.theme?.layout ?? 'standard'} data-header={s.theme?.header ?? 'solid'} dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}
      style={{ ['--color-primary' as string]: primary, ['--color-on-primary' as string]: onColor(primary), ['--color-accent' as string]: accent, ['--color-on-accent' as string]: onColor(accent) }}>
      <link rel="stylesheet" href={fontsHref(s.productSlug)} />
      <header className="top"><div className="container row between">
        <a className="row" href={base || '/'} style={{ color: 'inherit', textDecoration: 'none' }}>{brand.logoUrl ? <img className="logo-img" src={brand.logoUrl} alt={brand.name} /> : <span className="brand-mark" aria-hidden="true">{String(brand.name ?? '?').trim().slice(0, 1).toUpperCase()}</span>}<b style={{ fontSize: '1.25rem' }}>{brand.name}</b></a>
        <nav className="row" aria-label="Site"><a href={base || '/'}>{t('الرئيسية', 'Home')}</a>{(s.pages ?? []).map((pg) => <a key={pg.slug} href={`${base}/${pg.slug}`} aria-current={pg.slug === doc.slug ? 'page' : undefined}>{pg.title}</a>)}</nav></div></header>
      <main id="main">
        <section className="t-hero"><div className="container stack"><h1>{doc.title}</h1></div></section>
        {sections.map((sec, i) => <GenericSection key={i} type={sec.type} content={sec.content} hours={s.hours} address={brand.address} locale={locale} productSlug={s.productSlug} name={brand.name} />)}
      </main>
      <SiteFooter brand={brand} hours={s.hours} locale={locale} columns={s.theme?.footer === 'columns'} />
    </div>
  );
}
