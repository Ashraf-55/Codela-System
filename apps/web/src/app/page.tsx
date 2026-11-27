import Link from 'next/link';
import { PRODUCT_THEMES, type ProductSlug } from '@codela/design';
import { HeroPreview, Page, SiteFooter, SiteHeader, productIcon } from '@/components/Site';
import { Icon } from '@/components/Icon';
import { CONTENT, PRODUCT_NAMES } from '@/lib/content';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';

export default async function Home() {
  const locale = await getLocale(); const slugs = Object.keys(PRODUCT_NAMES); const L = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const platform: [string, string, string][] = [
    ['globe', L('موقع باسمك ودومينك', 'A website under your name'), L('قوالب لكل نشاط، صفحات SEO، معرض صور، مواعيد عمل، ونماذج حجز واستفسار تصل مباشرةً للوحة التحكم.', 'Templates per industry, SEO pages, gallery, opening hours, and booking or inquiry forms that land straight in your dashboard.')],
    ['grid', L('نظام إدارة مبني لنشاطك', 'A system built for your trade'), L('ليست لوحة عامة بأسماء مختلفة: لكل منتج سير عمله، من غرفة الانتظار إلى شاشة المطبخ إلى أوامر الشغل.', 'Not one generic dashboard renamed: each product has its own workflow, from the waiting room to the kitchen display to work orders.')],
    ['shield', L('صلاحيات وأدوار دقيقة', 'Roles and precise permissions'), L('أدوار جاهزة وأدوار مخصصة، سجل تدقيق لكل تعديل، وفصل تام بين بيانات كل نشاط.', 'Built-in and custom roles, an audit trail for every change, and strict separation between businesses.')],
    ['search', L('بحث شامل فوري', 'Instant global search'), L('ابحث في المرضى والطلبات والفواتير والعقارات من مكان واحد، مع احترام صلاحيات كل مستخدم.', 'Search patients, orders, invoices and listings from one box, filtered by what each person is allowed to see.')],
    ['chart', L('تقارير تفهمها', 'Reports you can read'), L('مؤشرات الأداء والتقارير لكل منتج، وتصدير CSV لأي قائمة.', 'KPIs and reports for every product, and a CSV export for any list.')],
    ['languages', L('عربي وإنجليزي بالكامل', 'Arabic and English throughout'), L('واجهة من اليمين لليسار ومن اليسار لليمين، وأرقام وعملات محلية.', 'Right-to-left and left-to-right layouts, with local numerals and currencies.')],
  ];
  return (
    <>
      <SiteHeader locale={locale} />
      <Page>
        <section className="hero"><div className="container hero-grid">
          <div className="stack" style={{ gap: 20 }}>
            <h1>{t('heroTitle', locale)}</h1><p>{t('heroSub', locale)}</p>
            <div className="row"><Link className="btn signal lg" href="/register">{t('register', locale)}</Link><Link className="btn lg hero-ghost" href="/contact">{t('requestDemo', locale)}</Link></div>
            <ul className="hero-points">{[L('تجربة مجانية بدون بطاقة', 'Free trial, no card required'), L('بياناتك لا تُحذف أبدًا', 'Your data is never deleted'), L('عربي وإنجليزي', 'Arabic and English')].map((x) => <li key={x}><Icon name="check" size={15} />{x}</li>)}</ul>
          </div>
          <HeroPreview locale={locale} />
        </div></section>

        <section id="products" className="section"><div className="container">
          <div className="section-intro"><h2>{L('منتج مخصص لكل نوع نشاط', 'A product made for each kind of business')}</h2><p>{L('اختر مجالك: كل منتج يأتي بموقعه العام ولوحة تحكمه وتقاريره وسير عمله الخاص.', 'Pick your field: each product comes with its own public website, dashboard, reports and workflow.')}</p></div>
          <div className="grid product-grid">{slugs.map((s) => (
            <Link key={s} href={`/products/${s}`} className="card pcard" style={{ ['--pc' as string]: PRODUCT_THEMES[s as ProductSlug].primary }}>
              <span className="p-icon" aria-hidden="true">{productIcon(s)}</span>
              <h3>{PRODUCT_NAMES[s][locale]}</h3><p className="muted">{CONTENT[s].tagline[locale]}</p><p className="small muted">{CONTENT[s].audience[locale]}</p>
            </Link>))}</div>
        </div></section>

        <section className="section alt"><div className="container">
          <div className="section-intro"><h2>{L('ما يحصل عليه كل مشترك', 'What every subscriber gets')}</h2><p>{L('أساس واحد موثوق تحت المنتجات العشرة.', 'One dependable foundation under all ten products.')}</p></div>
          <div className="grid g3 feature-grid">{platform.map(([icon, h, p]) => <div key={h} className="feature"><span className="kpi-icon" aria-hidden="true"><Icon name={icon} size={18} /></span><h3>{h}</h3><p className="muted">{p}</p></div>)}</div>
        </div></section>

        <section className="section"><div className="container">
          <div className="section-intro"><h2>{t('howTitle', locale)}</h2></div>
          <ol className="steps">{(locale === 'ar' ? [['اختر المنتج المناسب لنشاطك', 'عشرة منتجات، كل منها بموقع ونظام إدارة.'], ['فعّل تجربتك المجانية في دقائق', 'اسم النشاط والبريد وكلمة المرور فقط.'], ['أدر نشاطك وانشر موقعك', 'باسمك ودومينك، وجدّد أو طوّر باقتك متى شئت.']] : [['Pick the product for your business', 'Ten products, each with a website and a management system.'], ['Start your free trial in minutes', 'Just a business name, e-mail and password.'], ['Run your business and publish your site', 'Under your own name and domain; renew or upgrade any time.']]).map(([h, p]) => <li key={h}><h3>{h}</h3><p className="muted">{p}</p></li>)}</ol>
        </div></section>

        <section className="section cta-band"><div className="container row between">
          <div><h2 style={{ margin: 0 }}>{L('جاهز تبدأ؟', 'Ready to start?')}</h2><p style={{ margin: '6px 0 0' }}>{L('جرّب المنتج المناسب لنشاطك مجانًا.', 'Try the product for your business free of charge.')}</p></div>
          <div className="row"><Link className="btn signal lg" href="/register">{t('register', locale)}</Link><Link className="btn lg hero-ghost" href="/pricing">{t('pricing', locale)}</Link></div>
        </div></section>
      </Page>
      <SiteFooter locale={locale} />
    </>
  );
}
