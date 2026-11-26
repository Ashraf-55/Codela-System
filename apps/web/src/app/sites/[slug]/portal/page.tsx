import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PortalApp } from '@/components/PortalApp';
import { ROOT_DOMAIN, requestHost, serverApi } from '@/lib/server-api';
import type { Locale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account', robots: { index: false } };
const host = async (slug: string) => (slug === '_host' ? await requestHost() : `${slug}.${ROOT_DOMAIN}`);

export default async function Portal(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params; const site = await serverApi<{ brand: { name: string }; locale: Locale; currency: string }>('/public/site', await host(slug));
  if (!site.data) notFound();
  const locale = site.data.locale === 'en' ? 'en' : 'ar';
  return (
    <main id="main" className="container" dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} style={{ paddingBlock: 32 }}>
      <PortalApp site={slug === '_host' ? undefined : slug} locale={locale} currency={site.data.currency} brandName={site.data.brand.name} />
    </main>
  );
}
