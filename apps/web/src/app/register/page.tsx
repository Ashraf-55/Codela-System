import Link from 'next/link';
import { RegisterForm } from '@/components/Forms';
import { PRODUCT_NAMES } from '@/lib/content';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
export const metadata = { title: 'Start free trial' };
export default async function Register(props: { searchParams: Promise<{ product?: string }> }) {
  const searchParams = await props.searchParams; const locale = await getLocale(); const products = Object.entries(PRODUCT_NAMES).map(([slug, n]) => ({ slug, name: n[locale] }));
  return <main id="main" className="auth"><div className="card stack"><Link href="/" className="logo">codela<i>.</i></Link><h2>{t('register', locale)}</h2>
    <RegisterForm products={products} initialProduct={searchParams.product && PRODUCT_NAMES[searchParams.product] ? searchParams.product : 'medical'} /><p className="muted small">{t('haveAccount', locale)} <Link href="/login">{t('login', locale)}</Link></p></div></main>;
}
