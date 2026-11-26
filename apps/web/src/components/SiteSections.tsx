import { fallbackContent, DEFAULT_HOURS, type SiteLocale } from '@codela/shared';

export interface SiteItem { title?: string; text?: string; photoUrl?: string }
export interface SiteContent { title?: string; text?: string; items?: SiteItem[] }
export interface Hours { weekly: { day: number; closed?: boolean; open?: string; close?: string }[]; holidays: { date: string; label?: string }[] }

const DAYS = { ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
export const isEmptyContent = (c?: SiteContent) => !c || (!c.title && !c.text && !(c.items && c.items.length));
/** The text a section shows: the owner's own, or the product default when the owner left it completely empty. */
export const sectionContent = (productSlug: string, type: string, locale: SiteLocale, name: string, c?: SiteContent): SiteContent =>
  isEmptyContent(c) ? (fallbackContent(productSlug, type, locale, name) ?? {}) : (c as SiteContent);

const Check = () => <span aria-hidden="true" style={{ color: 'var(--color-accent)', fontWeight: 800 }}>✓</span>;

export function HoursTable({ hours, locale }: { hours?: Hours | null; locale: SiteLocale }) {
  const h = hours ?? DEFAULT_HOURS; const names = DAYS[locale]; const byDay = new Map(h.weekly.map((d) => [d.day, d]));
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  return (
    <div className="stack">
      <div className="table-wrap"><table><caption className="sr-only">{t('ساعات العمل', 'Working hours')}</caption>
        <thead><tr><th scope="col">{t('اليوم', 'Day')}</th><th scope="col">{t('الساعات', 'Hours')}</th></tr></thead>
        <tbody>{[6, 0, 1, 2, 3, 4, 5].map((day) => { const d = byDay.get(day); return (
          <tr key={day}><th scope="row">{names[day]}</th><td>{!d || d.closed ? <span className="muted">{t('مغلق', 'Closed')}</span> : <span className="mono">{d.open} – {d.close}</span>}</td></tr>); })}</tbody></table></div>
      {h.holidays.length > 0 && <div><h3 style={{ fontSize: '1rem' }}>{t('الإجازات الرسمية', 'Holidays')}</h3>
        <ul>{h.holidays.map((x, i) => <li key={i}><span className="mono">{x.date}</span>{x.label ? ` — ${x.label}` : ''}</li>)}</ul></div>}
    </div>
  );
}

/** about / services / team / gallery / hours / faq / testimonials / pricing / map — the sections the owner edits in the website builder. */
export function GenericSection({ type, content, hours, address, locale, productSlug, name }: { type: string; content?: SiteContent; hours?: Hours | null; address?: string | null; locale: SiteLocale; productSlug: string; name: string }) {
  const c = sectionContent(productSlug, type, locale, name, content); const items = c.items ?? [];
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const fallbackTitle: Record<string, [string, string]> = { about: ['من نحن', 'About us'], services: ['خدماتنا', 'Our services'], team: ['فريق العمل', 'Our team'], gallery: ['معرض الصور', 'Gallery'], hours: ['ساعات العمل', 'Working hours'], faq: ['أسئلة شائعة', 'FAQ'], testimonials: ['آراء العملاء', 'What clients say'], pricing: ['الأسعار', 'Pricing'], map: ['موقعنا', 'Find us'], products: ['منتجاتنا', 'Our products'], booking: ['الحجز', 'Booking'] };
  const title = c.title || (fallbackTitle[type] ? t(...fallbackTitle[type]) : type);
  if (type === 'hours') return <section id="sec-hours" className="block"><div className="container stack"><h2>{title}</h2>{c.text && <p>{c.text}</p>}<HoursTable hours={hours} locale={locale} /></div></section>;
  if (type === 'map') return <section id="sec-map" className="block"><div className="container stack"><h2>{title}</h2>{c.text && <p>{c.text}</p>}{address && <p><span>{address}</span> · <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer">{t('افتح الخريطة', 'Open map')}</a></p>}</div></section>;
  return (
    <section id={`sec-${type}`} className="block"><div className="container stack"><h2>{title}</h2>{c.text && <p style={{ maxWidth: '70ch' }}>{c.text}</p>}
      {type === 'about' && items.length > 0 && <ul className="grid g2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{items.map((x, i) => <li key={i} className="row" style={{ gap: 8 }}><Check /><span>{x.title}</span></li>)}</ul>}
      {type === 'services' && items.length > 0 && <div className="grid g3">{items.map((x, i) => <article key={i} className="card cat-card"><h3>{x.title}</h3>{x.text && <p className="small muted">{x.text}</p>}</article>)}</div>}
      {type === 'team' && items.length > 0 && <div className="grid g3">{items.map((x, i) => <article key={i} className="card cat-card" style={{ textAlign: 'center' }}>
        {x.photoUrl ? <img src={x.photoUrl} alt={x.title ?? ''} loading="lazy" style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', margin: '0 auto' }} /> : <span className="brand-mark" aria-hidden="true" style={{ margin: '0 auto' }}>{String(x.title ?? '?').trim().slice(0, 1).toUpperCase()}</span>}
        <h3>{x.title}</h3>{x.text && <p className="small muted">{x.text}</p>}</article>)}</div>}
      {type === 'gallery' && items.length > 0 && <div className="grid g3">{items.filter((x) => x.photoUrl).map((x, i) => <figure key={i} style={{ margin: 0 }}><img src={x.photoUrl} alt={x.title || t('صورة من المعرض', 'Gallery image')} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius)' }} />{x.title && <figcaption className="small muted">{x.title}</figcaption>}</figure>)}</div>}
      {type === 'faq' && items.length > 0 && <div className="stack">{items.map((x, i) => <details key={i} className="card flat"><summary><b>{x.title}</b></summary>{x.text && <p>{x.text}</p>}</details>)}</div>}
      {['testimonials', 'pricing', 'products', 'booking'].includes(type) && items.length > 0 && <div className="grid g3">{items.map((x, i) => <article key={i} className="card cat-card"><h3>{x.title}</h3>{x.text && <p className="small muted">{x.text}</p>}</article>)}</div>}
    </div></section>
  );
}

const SOCIAL_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', twitter: 'X', youtube: 'YouTube', linkedin: 'LinkedIn', tiktok: 'TikTok', whatsapp: 'WhatsApp' };
export function SiteFooter({ brand, hours, locale, columns }: { brand: Record<string, any>; hours?: Hours | null; locale: SiteLocale; columns: boolean }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en); const socials = Object.entries((brand.socials ?? {}) as Record<string, string>);
  const open = (hours ?? DEFAULT_HOURS).weekly.filter((d) => !d.closed); const first = open[0];
  return (
    <footer><div className="container stack">
      {columns && <div className="grid g3">
        <div className="stack"><b style={{ color: '#fff' }}>{brand.name}</b>{brand.description && <span className="small">{String(brand.description).slice(0, 220)}</span>}</div>
        <div className="stack"><b style={{ color: '#fff' }}>{t('تواصل', 'Contact')}</b>{brand.phone && <span className="mono small">{brand.phone}</span>}{brand.email && <span className="mono small">{brand.email}</span>}{brand.address && <span className="small">{brand.address}</span>}</div>
        <div className="stack"><b style={{ color: '#fff' }}>{t('ساعات العمل', 'Hours')}</b>{first ? <span className="small mono">{first.open} – {first.close}</span> : <span className="small">{t('مغلق', 'Closed')}</span>}</div>
      </div>}
      {socials.length > 0 && <nav aria-label={t('وسائل التواصل', 'Social links')} className="row" style={{ gap: 16, flexWrap: 'wrap' }}>{socials.map(([k, u]) => <a key={k} href={u} target="_blank" rel="noopener noreferrer">{SOCIAL_LABEL[k] ?? k}</a>)}</nav>}
      <div className="small">© {new Date().getFullYear()} {brand.name} · {t('بدعم من', 'Powered by')} <a href="https://codela.tech" style={{ color: '#fff', textDecoration: 'underline' }}>Codela</a></div>
    </div></footer>
  );
}
