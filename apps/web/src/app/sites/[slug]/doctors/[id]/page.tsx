import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { contrastRatio } from '@codela/design';
import { fontsHref } from '@/lib/fonts';
import { ROOT_DOMAIN, requestHost, serverApi } from '@/lib/server-api';
import { fmtMoney, type Locale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
interface Site { brand: Record<string, any>; locale: Locale; currency: string; productSlug: string }
const host = async (slug: string) => (slug === '_host' ? await requestHost() : `${slug}.${ROOT_DOMAIN}`);
const SAFE = /^#[0-9a-fA-F]{6}$/; const onColor = (bg: string) => (contrastRatio('#ffffff', bg) >= 4.5 ? '#ffffff' : '#0b1b2b');
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const safeImg = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);
const safeEmbed = (u?: string) => (u && /^https:\/\/www\.google\.com\/maps\/embed\?[^\s"'<>]+$/.test(u) ? u : undefined);

async function load(slug: string, id: string) {
  const h = await host(slug); const site = await serverApi<Site>('/public/site', h); if (!site.data || site.data.productSlug !== 'medical') return null;
  let doc: any; for (let p = 1; p <= 10 && !doc; p++) { const r = await serverApi<any[]>(`/public/catalog/doctor?pageSize=50&page=${p}`, h); doc = (r.data ?? []).find((d) => d.id === id); if (!(r.data ?? []).length) break; }
  if (!doc) return null;
  const [sched, specs, branches] = await Promise.all([serverApi<any[]>(`/public/catalog/doctorSchedule?doctorId=${id}&pageSize=50`, h), serverApi<any[]>('/public/catalog/specialty?pageSize=50', h), serverApi<any[]>('/public/catalog/branch?pageSize=50', h)]);
  return { s: site.data, doc, schedules: sched.data ?? [], spec: (specs.data ?? []).find((x) => x.id === doc.specialtyId), branches: branches.data ?? [] };
}
export async function generateMetadata(props: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { slug, id } = await props.params; const d = await load(slug, id); return d ? { title: { absolute: `${d.doc.name} — ${d.s.brand.name}` }, description: String(d.doc.bio ?? '').slice(0, 160) || undefined } : { title: 'Not found' };
}

/** Stand-alone doctor profile page: photo, specialty, bio, fee, working hours per branch, location map and a booking hand-off. */
export default async function DoctorProfile(props: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await props.params; const d = await load(slug, id); if (!d) notFound();
  const { s, doc, schedules, spec, branches } = d; const locale: Locale = s.locale === 'en' ? 'en' : 'ar'; const t = (ar: string, en: string) => (locale === 'ar' ? ar : en); const names = locale === 'ar' ? DAYS_AR : DAYS_EN;
  const primary = SAFE.test(s.brand.primaryColor ?? '') ? s.brand.primaryColor : '#0f766e'; const accent = SAFE.test(s.brand.secondaryColor ?? '') ? s.brand.secondaryColor : '#b45309';
  const back = slug === '_host' ? '/' : `/sites/${slug}`; const img = safeImg(doc.image); const branch = branches.find((b: any) => b.id === doc.branchId); const embed = safeEmbed(branch?.mapEmbedUrl);
  const sorted = [...schedules].sort((a: any, b: any) => a.weekday - b.weekday || a.from.localeCompare(b.from));
  return (
    <div className="tsite" data-product="medical" dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} style={{ ['--color-primary' as string]: primary, ['--color-on-primary' as string]: onColor(primary), ['--color-accent' as string]: accent, ['--color-on-accent' as string]: onColor(accent) }}>
      <link rel="stylesheet" href={fontsHref('medical')} />
      <header className="top"><div className="container row between"><a className="row" href={back} style={{ textDecoration: 'none', color: 'inherit' }}><span className="brand-mark" aria-hidden="true">{String(s.brand.name ?? '?').trim().slice(0, 1).toUpperCase()}</span><b style={{ fontSize: '1.25rem' }}>{s.brand.name}</b></a>
        <nav className="row"><a href={back}>{t('← كل الأطباء', '← All doctors')}</a><a className="cta" href={`${back}#book`}>{t('احجز الآن', 'Book now')}</a></nav></div></header>
      <main id="main" className="block"><div className="container stack">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 24 }}>
          {img ? <img src={img} alt={doc.name} width={180} height={180} style={{ borderRadius: '50%', objectFit: 'cover', width: 180, height: 180 }} /> : <span className="brand-mark" aria-hidden="true" style={{ width: 180, height: 180, borderRadius: '50%', fontSize: 72 }}>{String(doc.name).replace(/^(dr\.?|د\.?)\s*/i, '').trim().slice(0, 1).toUpperCase()}</span>}
          <div className="stack" style={{ flex: 1, minWidth: 260 }}><h1>{doc.name}</h1>{spec && <p className="muted" style={{ fontSize: '1.15rem' }}>{spec.name}</p>}
            {doc.consultationFee ? <p><b>{t('سعر الكشف', 'Consultation fee')}:</b> {fmtMoney(doc.consultationFee, s.currency, locale)}</p> : null}
            <div><a className="btn primary" href={`${back}#book`}>{t('احجز موعدًا مع الطبيب', 'Book with this doctor')}</a></div></div></div>
        {doc.bio && <section className="stack"><h2>{t('نبذة', 'About')}</h2><p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{doc.bio}</p></section>}
        <section className="stack"><h2>{t('مواعيد العمل', 'Working hours')}</h2>
          {!sorted.length ? <p className="muted">{t('يرجى التواصل لمعرفة المواعيد.', 'Please contact us for working hours.')}</p> : <table><tbody>{sorted.map((r: any, i: number) => { const b = branches.find((x: any) => x.id === r.branchId); return <tr key={i}><td>{names[r.weekday]}</td><td className="mono">{r.from} – {r.to}</td><td>{b?.name ?? ''}</td></tr>; })}</tbody></table>}</section>
        {branch && <section className="stack"><h2>{t('الموقع', 'Location')}</h2><p><b>{branch.name}</b>{branch.address ? ` — ${branch.address}` : ''}{branch.phone ? ` · ${branch.phone}` : ''}</p>
          {embed ? <iframe title={t('خريطة', 'Map')} src={embed} width="100%" height="320" style={{ border: 0, borderRadius: 12 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : branch.mapUrl ? <a className="btn" href={branch.mapUrl} target="_blank" rel="noopener noreferrer">{t('افتح الخريطة', 'Open map')}</a> : null}</section>}
      </div></main>
    </div>
  );
}
