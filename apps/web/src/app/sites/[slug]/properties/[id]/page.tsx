import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { contrastRatio } from '@codela/design';
import { fontsHref } from '@/lib/fonts';
import { ROOT_DOMAIN, requestHost, serverApi } from '@/lib/server-api';
import { fmtMoney, type Locale } from '@/lib/i18n';
import { ViewingButton } from '@/components/EstateSite';

export const dynamic = 'force-dynamic';
interface Site { brand: Record<string, any>; locale: Locale; currency: string; productSlug: string }
const host = async (slug: string) => (slug === '_host' ? await requestHost() : `${slug}.${ROOT_DOMAIN}`);
const SAFE = /^#[0-9a-fA-F]{6}$/; const onColor = (bg: string) => (contrastRatio('#ffffff', bg) >= 4.5 ? '#ffffff' : '#0b1b2b');
const safeImg = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);
const safeEmbed = (u?: string) => (u && /^https:\/\/www\.google\.com\/maps\/embed\?[^\s"'<>]+$/.test(u) ? u : undefined);
const safeLink = (u?: string) => (u && /^https:\/\//.test(u) ? u : undefined);

async function load(slug: string, id: string) {
  const h = await host(slug); const site = await serverApi<Site>('/public/site', h); if (!site.data || site.data.productSlug !== 'realestate') return null;
  let p: any; for (let page = 1; page <= 20 && !p; page++) { const r = await serverApi<any[]>(`/public/catalog/property?pageSize=50&page=${page}`, h); const rows = r.data ?? []; p = rows.find((x) => x.id === id); if (rows.length < 50) break; }
  if (!p) return null; // sold / hidden / unknown properties have no public page
  const [loc, types] = await Promise.all([serverApi<any[]>('/public/catalog/location?pageSize=100', h), serverApi<any[]>('/public/catalog/propertyType?pageSize=100', h)]);
  return { s: site.data, p, loc: (loc.data ?? []).find((x) => x.id === p.locationId), type: (types.data ?? []).find((x) => x.id === p.typeId) };
}
export async function generateMetadata(props: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { slug, id } = await props.params; const d = await load(slug, id); if (!d) return { title: 'Not found' };
  const img = safeImg(d.p.images?.[0]?.url); const desc = String(d.p.description ?? '').slice(0, 160) || undefined;
  return { title: { absolute: `${d.p.title} — ${d.s.brand.name}` }, description: desc, openGraph: { title: d.p.title, description: desc, ...(img ? { images: [img] } : {}) } };
}

/** Stand-alone page for one property: its own URL (shareable, indexable), gallery, specs, features, map and a viewing request. */
export default async function PropertyPage(props: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await props.params; const d = await load(slug, id); if (!d) notFound();
  const { s, p } = d; const locale: Locale = s.locale === 'en' ? 'en' : 'ar'; const t = (ar: string, en: string) => (locale === 'ar' ? ar : en); const money = (n: number) => fmtMoney(n, s.currency, locale);
  const primary = SAFE.test(s.brand.primaryColor ?? '') ? s.brand.primaryColor : '#0f766e'; const accent = SAFE.test(s.brand.secondaryColor ?? '') ? s.brand.secondaryColor : '#b45309';
  const back = slug === '_host' ? '/' : `/sites/${slug}`; const imgs = ((p.images ?? []) as { url: string; caption?: string }[]).filter((x) => safeImg(x.url)); const feats = String(p.features ?? '').split(/[\n,،]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30); const embed = safeEmbed(p.mapEmbedUrl);
  return (
    <div className="tsite" data-product="realestate" dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} style={{ ['--color-primary' as string]: primary, ['--color-on-primary' as string]: onColor(primary), ['--color-accent' as string]: accent, ['--color-on-accent' as string]: onColor(accent) }}>
      <link rel="stylesheet" href={fontsHref('realestate')} />
      <header className="top"><div className="container row between"><a className="row" href={back} style={{ textDecoration: 'none', color: 'inherit' }}><span className="brand-mark" aria-hidden="true">{String(s.brand.name ?? '?').trim().slice(0, 1).toUpperCase()}</span><b style={{ fontSize: '1.25rem' }}>{s.brand.name}</b></a><nav className="row"><a href={`${back}#properties`}>{t('← كل العقارات', '← All properties')}</a></nav></div></header>
      <main id="main" className="block"><div className="container stack">
        <div className="row between" style={{ flexWrap: 'wrap' }}><div><span className="badge info">{p.purpose === 'sale' ? t('للبيع', 'For sale') : t('للإيجار', 'For rent')}</span><h1 style={{ margin: '6px 0 0' }}>{p.title}</h1><p className="muted">{[d.loc?.name, d.type?.name, p.address].filter(Boolean).join(' · ')}</p></div><b className="mono" style={{ fontSize: '1.8rem' }}>{money(p.price)}{p.purpose === 'rent' ? ` / ${t('شهر', 'mo')}` : ''}</b></div>
        {imgs.length > 0 && <div className="grid g3">{imgs.map((x, i) => <figure key={i} style={{ margin: 0 }}><img src={safeImg(x.url)} alt={x.caption || p.title} loading={i ? 'lazy' : 'eager'} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 12 }} /></figure>)}</div>}
        <dl className="grid g4" style={{ margin: 0 }}>{([[t('المساحة', 'Area'), p.area ? `${p.area} ${t('م²', 'm²')}` : ''], [t('غرف النوم', 'Bedrooms'), p.bedrooms], [t('الحمامات', 'Bathrooms'), p.bathrooms], [t('الدور', 'Floor'), p.floor]] as [string, unknown][]).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => <div key={k} className="card flat"><dt className="small muted">{k}</dt><dd style={{ margin: 0 }}><b>{String(v)}</b></dd></div>)}</dl>
        {p.description && <section className="stack"><h2>{t('الوصف', 'Description')}</h2><p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{p.description}</p></section>}
        {feats.length > 0 && <section className="stack"><h2>{t('المميزات', 'Features')}</h2><ul className="grid g3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{feats.map((f, i) => <li key={i}>✓ {f}</li>)}</ul></section>}
        {(embed || safeLink(p.mapUrl) || safeLink(p.videoUrl)) && <section className="stack"><h2>{t('الموقع', 'Location')}</h2>{embed && <iframe title={t('خريطة', 'Map')} src={embed} width="100%" height="320" style={{ border: 0, borderRadius: 12 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}<div className="row">{safeLink(p.mapUrl) && <a className="btn" href={safeLink(p.mapUrl)} target="_blank" rel="noopener noreferrer">{t('افتح الخريطة', 'Open map')}</a>}{safeLink(p.videoUrl) && <a className="btn" href={safeLink(p.videoUrl)} target="_blank" rel="noopener noreferrer">{t('شاهد الفيديو', 'Watch video')}</a>}</div></section>}
        <ViewingButton id={p.id} label={p.title} locale={locale} site={slug === '_host' ? undefined : slug} />
      </div></main>
    </div>
  );
}
