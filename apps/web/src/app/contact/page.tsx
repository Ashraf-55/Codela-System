import { Page, SiteFooter, SiteHeader } from '@/components/Site';
import { ContactForm } from '@/components/Forms';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
export const metadata = { title: 'Contact' };
export default async function Contact() {
  const locale = await getLocale();
  return <><SiteHeader locale={locale} /><Page><section className="section"><div className="container stack" style={{ maxWidth: 640 }}><h1>{t('requestDemo', locale)}</h1><div className="card"><ContactForm /></div></div></section></Page><SiteFooter locale={locale} /></>;
}
