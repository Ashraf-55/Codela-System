import Link from 'next/link';
import { PRODUCT_THEMES, type ProductSlug } from '@codela/design';
import { Page, SiteFooter, SiteHeader } from '@/components/Site';
import { CONTENT, PRODUCT_NAMES } from '@/lib/content';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';

export default async function Home() {
  const locale = await getLocale(); const slugs = Object.keys(PRODUCT_NAMES);
  return (
    <>
      <SiteHeader locale={locale} />
      <Page>
        <section className="hero"><div className="container stack">
          <span className="badge" style={{ width: 'fit-content', color: '#f5b83d', background: 'transparent', borderColor: 'rgba(255,255,255,.25)' }}>CODELA TECHNOLOGY</span>
          <h1>{t('heroTitle', locale)}</h1><p>{t('heroSub', locale)}</p>
          <div className="row"><Link className="btn signal" href="/register">{t('register', locale)}</Link><Link className="btn" href="/contact" style={{ background: 'transparent', color: '#fff' }}>{t('requestDemo', locale)}</Link></div>
        </div></section>
        <section id="products" className="section"><div className="container stack"><h2>{t('products', locale)}</h2>
          <div className="grid g2">{slugs.map((s) => (
            <Link key={s} href={`/products/${s}`} className="card pcard" style={{ ['--pc' as string]: PRODUCT_THEMES[s as ProductSlug].primary, textDecoration: 'none' }}>
              <h3>{PRODUCT_NAMES[s][locale]}</h3><span className="muted">{CONTENT[s].tagline[locale]}</span><span className="small muted">{CONTENT[s].audience[locale]}</span>
            </Link>))}</div></div></section>
        <section className="section alt"><div className="container stack"><h2>{t('howTitle', locale)}</h2>
          <div className="grid g3">{(locale === 'ar' ? ['اختر المنتج المناسب لنشاطك', 'فعّل تجربتك المجانية في دقائق', 'أدر نشاطك وانشر موقعك باسمك ودومينك'] : ['Pick the product for your business', 'Start your free trial in minutes', 'Run your business and publish your branded website']).map((x, i) => (
            <div key={i} className="card"><b style={{ fontSize: '1.6rem', color: 'var(--color-accent)' }}>{i + 1}</b><p>{x}</p></div>))}</div></div></section>
      </Page>
      <SiteFooter locale={locale} />
    </>
  );
}
