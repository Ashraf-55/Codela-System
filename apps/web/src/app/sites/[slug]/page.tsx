import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { contrastRatio } from '@codela/design';
import { PublicForm, TrackWidget } from '@/components/SitePublic';
import { BookingWizard, ManageBooking } from '@/components/BookingWizard';
import { MedicalSections } from '@/components/MedicalSite';
import { RestaurantMenu } from '@/components/RestaurantSite';
import { Storefront } from '@/components/StoreSite';
import { PayPanel } from '@/components/PayPanel';
import { EstateSite } from '@/components/EstateSite';
import { AutoSite } from '@/components/AutoSite';
import { LearnSite } from '@/components/LearnSite';
import { BuildSite } from '@/components/BuildSite';
import { BusinessSite } from '@/components/BusinessSite';
import { GenericSection, SiteFooter, sectionContent, type Hours, type SiteContent } from '@/components/SiteSections';
import { fontsHref } from '@/lib/fonts';
import { hasTracker } from '@/lib/track';
import { ROOT_DOMAIN, requestHost, serverApi } from '@/lib/server-api';
import { fieldLabel, fmtMoney, type Locale } from '@/lib/i18n';

interface Seo { title?: string; description?: string; ogImage?: string | null; keywords?: string; noindex?: boolean }
interface Theme { font?: string; layout?: string; header?: string; footer?: string }
interface Site { templateKey: string; brand: Record<string, any>; sections: { type: string; enabled: boolean; content: SiteContent }[]; seo?: Seo; hours?: Hours | null; theme?: Theme; pages?: { slug: string; title: string }[]; locale: Locale; currency: string; productSlug: string }
interface Meta { productSlug: string; catalogs: { entity: string; labelEn: string; labelAr: string; titleField: string; fields: { key: string; type: string }[] }[]; forms: { key: string; labelEn: string; labelAr: string; fields: Record<string, { type: string; required: boolean; values?: string[]; entity?: string }> }[] }
export const dynamic = 'force-dynamic';
const HERO_CTA: Record<string, { ar: string; en: string }> = {
  medical: { ar: 'تعرّف على أطبائنا', en: 'Meet our doctors' }, realestate: { ar: 'تصفّح العقارات', en: 'Browse properties' }, ecommerce: { ar: 'تسوّق الآن', en: 'Shop now' }, restaurant: { ar: 'شاهد المنيو', en: 'View the menu' },
  automotive: { ar: 'خدماتنا وقطع الغيار', en: 'Services & parts' }, learning: { ar: 'استكشف الكورسات', en: 'Explore courses' }, construction: { ar: 'شاهد مشروعاتنا', en: 'See our projects' },
  booking: { ar: 'احجز موعدك', en: 'Book your slot' }, fleet: { ar: 'خدمات الشحن', en: 'Shipping services' }, business: { ar: 'خدماتنا', en: 'Our services' },
};
const host = async (slug: string) => (slug === '_host' ? await requestHost() : `${slug}.${ROOT_DOMAIN}`);

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params; const r = await serverApi<Site>('/public/site', await host(slug)); if (!r.data) return { title: 'Site not found' };
  const { brand, seo = {} } = r.data; const title = seo.title || brand.name; const description = seo.description || brand.description || undefined; const img = seo.ogImage || brand.logoUrl || undefined;
  return { title: { absolute: title }, description, keywords: seo.keywords || undefined, robots: seo.noindex ? { index: false, follow: false } : undefined,
    openGraph: { title, description, siteName: brand.name, type: 'website', ...(img ? { images: [img] } : {}) }, twitter: { card: img ? 'summary_large_image' : 'summary', title, description }, icons: brand.faviconUrl ? { icon: brand.faviconUrl } : undefined };
}
const onColor = (bg: string) => (contrastRatio('#ffffff', bg) >= 4.5 ? '#ffffff' : '#0b1b2b');
const SAFE = /^#[0-9a-fA-F]{6}$/;

export default async function TenantSite(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params; const h = await host(params.slug); const site = await serverApi<Site>('/public/site', h); if (!site.data) notFound();
  const s = site.data; const meta = (await serverApi<Meta>('/public/site-meta', h)).data; const locale = s.locale === 'en' ? 'en' : 'ar'; const brand = s.brand;
  const primary = SAFE.test(brand.primaryColor ?? '') ? brand.primaryColor : '#0f766e'; const accent = SAFE.test(brand.secondaryColor ?? '') ? brand.secondaryColor : '#b45309';
  const CUSTOM: Record<string, string[]> = { medical: ['doctor', 'doctorSchedule', 'faq', 'article', 'specialty', 'branch'], restaurant: ['menuCategory', 'menuItem'], ecommerce: ['category', 'product', 'variant', 'shippingMethod', 'paymentMethod', 'policy'], realestate: ['property', 'unit', 'project', 'broker', 'location', 'propertyType'], automotive: ['service', 'sparePart'], learning: ['category', 'instructor', 'course', 'faq', 'review'], construction: ['project', 'service', 'teamMember'], business: ['service', 'industry', 'portfolioItem', 'teamMember', 'job'] }; const custom = CUSTOM[s.productSlug] ?? [];
  const all = async (entity: string, maxPages = 10) => { const out: any[] = []; for (let p = 1; p <= maxPages; p++) { const r = await serverApi<any[]>(`/public/catalog/${entity}?pageSize=50&page=${p}`, h); out.push(...(r.data ?? [])); if (out.length >= ((r as any).meta?.total ?? 0) || !(r.data ?? []).length) break; } return out; };
  const med = s.productSlug === 'medical' ? { doctors: await all('doctor'), specialties: await all('specialty'), schedules: await all('doctorSchedule'), faqs: await all('faq'), articles: await all('article'), branches: await all('branch') } : null;
  const rest = s.productSlug === 'restaurant' ? { cats: await all('menuCategory'), items: await all('menuItem') } : null;
  const auto = s.productSlug === 'automotive' ? { services: await all('service'), parts: await serverApi<any[]>('/public/catalog/sparePart?pageSize=12&sort=name', h) } : null;
  const learn = s.productSlug === 'learning' ? { cats: await all('category'), instructors: await all('instructor'), faqs: await all('faq'), courses: await serverApi<any[]>('/public/catalog/course?pageSize=9', h) } : null;
  const build = s.productSlug === 'construction' ? { services: await all('service'), projects: await all('project'), team: await all('teamMember') } : null;
  const biz = s.productSlug === 'business' ? { services: await all('service'), industries: await all('industry'), portfolio: await all('portfolioItem'), team: await all('teamMember'), jobs: await all('job') } : null;
  const estate = s.productSlug === 'realestate' ? { locations: await all('location'), types: await all('propertyType'), projects: await all('project'), brokers: await all('broker') } : null;
  const shop = s.productSlug === 'ecommerce' ? { cats: await all('category'), products: await serverApi<any[]>('/public/catalog/product?pageSize=12&page=1', h), ships: await all('shippingMethod'), pays: await all('paymentMethod'), policies: await all('policy') } : null;
  const catalogs = await Promise.all((meta?.catalogs ?? []).filter((c) => !custom.includes(c.entity)).slice(0, 6).map(async (c) => ({ c, rows: (await serverApi<any[]>(`/public/catalog/${c.entity}?pageSize=12`, h)).data ?? [] })));
  const refs: Record<string, { id: string; title: string }[]> = {}; for (const { c, rows } of catalogs) refs[c.entity] = rows.map((r) => ({ id: r.id, title: String(r[c.titleField] ?? r.name ?? r.title ?? r.id) }));
  const preview = params.slug === '_host' ? undefined : params.slug; const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  return (
    <div className={`tsite tpl-${s.templateKey}`} data-product={s.productSlug} data-font={s.theme?.font ?? 'default'} data-layout={s.theme?.layout ?? 'standard'} data-header={s.theme?.header ?? 'solid'} dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} style={{ ['--color-primary' as string]: primary, ['--color-on-primary' as string]: onColor(primary), ['--color-accent' as string]: accent, ['--color-on-accent' as string]: onColor(accent) }}>
      <link rel="stylesheet" href={fontsHref(s.productSlug)} />
      <header className="top"><div className="container row between">
        <span className="row">{brand.logoUrl ? <img className="logo-img" src={brand.logoUrl} alt={brand.name} /> : <span className="brand-mark" aria-hidden="true">{String(brand.name ?? '?').trim().slice(0, 1).toUpperCase()}</span>}<b style={{ fontSize: '1.25rem' }}>{brand.name}</b></span>
        <nav className="row" aria-label="Site">{s.sections.some((x) => x.enabled && x.type === 'about') && <a href="#sec-about">{t('من نحن', 'About')}</a>}{s.sections.some((x) => x.enabled && x.type === 'services') && <a href="#sec-services">{t('ماذا نقدّم', 'What we do')}</a>}{s.sections.some((x) => x.enabled && x.type === 'team') && <a href="#sec-team">{t('الفريق', 'Team')}</a>}{s.sections.some((x) => x.enabled && x.type === 'gallery') && <a href="#sec-gallery">{t('المعرض', 'Gallery')}</a>}{s.sections.some((x) => x.enabled && x.type === 'hours') && <a href="#sec-hours">{t('مواعيد العمل', 'Hours')}</a>}{catalogs.filter((x) => x.rows.length).map(({ c }) => <a key={c.entity} href={`#c-${c.entity}`}>{locale === 'ar' ? c.labelAr : c.labelEn}</a>)}{estate && <a href="#properties">{t('العقارات', 'Properties')}</a>}{biz && !!biz.services.length && <a href="#services">{t('الخدمات', 'Services')}</a>}{biz && !!biz.jobs.length && <a href="#careers">{t('الوظائف', 'Careers')}</a>}{biz && <a href="#quote">{t('عرض سعر', 'Get a quote')}</a>}{build && !!build.projects.length && <a href="#projects">{t('مشاريعنا', 'Projects')}</a>}{build && <a href="#request">{t('اطلب عرض سعر', 'Get a quote')}</a>}{learn && <a href="#courses">{t('الكورسات', 'Courses')}</a>}{learn && !!learn.faqs.length && <a href="#faq">{t('أسئلة شائعة', 'FAQ')}</a>}{auto && !!auto.services.length && <a href="#services">{t('الخدمات', 'Services')}</a>}{auto && <a href="#parts">{t('قطع الغيار', 'Parts')}</a>}{med && !!med.doctors.length && <a href="#doctors">{t('الأطباء', 'Doctors')}</a>}{med && !!med.faqs.length && <a href="#faq">{t('أسئلة شائعة', 'FAQ')}</a>}{rest && !!rest.items.length && <a className="cta" href="#menu">{t('المنيو والطلب', 'Menu & order')}</a>}{shop && !!(shop.products.data ?? []).length && <a className="cta" href="#store">{t('المتجر', 'Shop')}</a>}{(s.productSlug === 'booking' || med) && <a className="cta" href="#book">{t('احجز الآن', 'Book now')}</a>}<a className={s.productSlug === 'booking' ? undefined : 'cta'} href="#contact">{t('تواصل', 'Contact')}</a>{['medical', 'booking', 'ecommerce', 'learning'].includes(s.productSlug) && <a href={params.slug === '_host' ? '/portal' : `/sites/${params.slug}/portal`}>{t('حسابي', 'My account')}</a>}{(s.pages ?? []).map((pg) => <a key={pg.slug} href={params.slug === '_host' ? `/${pg.slug}` : `/sites/${params.slug}/${pg.slug}`}>{pg.title}</a>)}</nav></div></header>
      <main id="main">
        {s.sections.filter((x) => x.enabled).map((sec, i) => { const heroC = sec.type === 'hero' ? sectionContent(s.productSlug, 'hero', locale, brand.name, sec.content) : {}; return sec.type === 'hero' ? (
          <section key={i} className="t-hero"><div className="container stack" style={{ position: 'relative', zIndex: 1 }}><h1>{heroC.title || brand.name}</h1><p>{heroC.text || brand.description}</p>
            <div className="actions"><a className="btn primary" href={s.productSlug === 'booking' ? '#book' : med ? '#doctors' : rest ? '#menu' : shop ? '#store' : estate ? '#properties' : auto ? '#services' : learn ? '#courses' : build ? '#request' : biz ? '#quote' : catalogs.find((x) => x.rows.length) ? `#c-${catalogs.find((x) => x.rows.length)!.c.entity}` : '#contact'}>{HERO_CTA[s.productSlug]?.[locale] ?? t('استكشف', 'Explore')}</a><a className="btn" href="#contact">{t('تواصل معنا', 'Contact us')}</a></div></div></section>
        ) : sec.type === 'contact' ? null : <GenericSection key={i} type={sec.type} content={sec.content} hours={s.hours} address={brand.address} locale={locale} productSlug={s.productSlug} name={brand.name} />; })}
        {catalogs.filter((x) => x.rows.length).map(({ c, rows }) => (
          <section key={c.entity} id={`c-${c.entity}`} className="block"><div className="container stack"><h2>{locale === 'ar' ? c.labelAr : c.labelEn}</h2>
            <div className="grid g3">{rows.map((r) => (
              <article key={r.id} className="card cat-card"><h3>{String(r[c.titleField] ?? r.name ?? r.title ?? '')}</h3>
                {c.fields.filter((f) => f.key !== c.titleField && r[f.key] !== undefined && f.type !== 'lines' && f.type !== 'ref').slice(0, 4).map((f) => (
                  <div key={f.key} className="small">{f.type === 'money' ? <><span className="muted">{fieldLabel(f.key, locale)}: </span><b>{fmtMoney(Number(r[f.key]), s.currency, locale)}</b></> : <span className="muted">{String(r[f.key]).slice(0, 140)}</span>}</div>))}</article>))}</div></div></section>))}
        {med && <MedicalSections base={params.slug === '_host' ? '' : `/sites/${params.slug}`} branches={med.branches} doctors={med.doctors} specialties={med.specialties} schedules={med.schedules} services={(catalogs.find((x) => x.c.entity === 'service')?.rows ?? []) as any} faqs={med.faqs} articles={med.articles} locale={locale} currency={s.currency} site={preview} />}
        {biz && <BusinessSite services={biz.services} industries={biz.industries} portfolio={biz.portfolio} team={biz.team} jobs={biz.jobs} locale={locale} site={preview} />}
        {build && <BuildSite services={build.services} projects={build.projects} team={build.team} locale={locale} site={preview} />}
        {learn && <LearnSite cats={learn.cats} instructors={learn.instructors} faqs={learn.faqs} initial={{ rows: learn.courses.data ?? [], total: (learn.courses as any).meta?.total ?? 0 }} locale={locale} currency={s.currency} site={preview} />}
        {auto && <AutoSite services={auto.services} initial={{ rows: auto.parts.data ?? [], total: (auto.parts as any).meta?.total ?? 0 }} locale={locale} currency={s.currency} site={preview} />}
        {estate && <EstateSite locations={estate.locations} types={estate.types} projects={estate.projects} brokers={estate.brokers} locale={locale} currency={s.currency} site={preview} />}
        {shop && <Storefront cats={shop.cats} initial={{ rows: shop.products.data ?? [], total: (shop.products as any).meta?.total ?? 0 }} ships={shop.ships} pays={shop.pays} policies={shop.policies} locale={locale} currency={s.currency} site={preview} />}
        {rest && <RestaurantMenu cats={rest.cats} items={rest.items} locale={locale} currency={s.currency} site={preview} />}
        {s.productSlug === 'booking' && <section id="book" className="block"><div className="container stack"><div className="grid g2"><BookingWizard locale={locale} currency={s.currency} site={preview} /><ManageBooking locale={locale} currency={s.currency} site={preview} /></div></div></section>}
        {['ecommerce', 'learning', 'medical', 'booking', 'restaurant', 'automotive', 'construction', 'business', 'fleet'].includes(s.productSlug) && <PayPanel productSlug={s.productSlug} locale={locale} currency={s.currency} site={preview} />}
        <section id="contact" className="block"><div className="container stack"><h2>{t('تواصل معنا', 'Get in touch')}</h2>
          <div className="grid g2"><div className="stack">{brand.phone && <div><b>{fieldLabel('phone', locale)}:</b> <span className="mono">{brand.phone}</span></div>}{brand.email && <div><b>{fieldLabel('email_', locale)}:</b> <span className="mono">{brand.email}</span></div>}{brand.address && <div><b>{fieldLabel('address', locale)}:</b> {brand.address}</div>}
            {hasTracker(s.productSlug) && s.productSlug !== 'booking' && <TrackWidget productSlug={s.productSlug} locale={locale} site={preview} />}</div>
            <div className="stack">{(meta?.forms ?? []).map((f) => <PublicForm key={f.key} formKey={f.key} label={locale === 'ar' ? f.labelAr : f.labelEn} fields={f.fields} refs={refs} locale={locale} site={preview} />)}</div></div></div></section>
      </main>
      <SiteFooter brand={brand} hours={s.hours} locale={locale} columns={s.theme?.footer === 'columns'} />
    </div>
  );
}
