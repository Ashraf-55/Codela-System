import Link from 'next/link';
import { Logo } from '@/components/Site';
import { RegisterForm } from '@/components/Forms';
import { PRODUCT_NAMES } from '@/lib/content';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
export const metadata = { title: 'Start free trial' };
export default async function Register(props: { searchParams: Promise<{ product?: string }> }) {
  const searchParams = await props.searchParams; const locale = await getLocale(); const products = Object.entries(PRODUCT_NAMES).map(([slug, n]) => ({ slug, name: n[locale] }));
  return <main id="main" className="auth"><div className="card stack"><Logo /><div><h1>{t('register', locale)}</h1><p className="muted small" style={{ margin: 0 }}>{locale === 'ar' ? 'جرّب مجانًا، بدون بطاقة. يمكنك تغيير الباقة لاحقًا.' : 'Free to try, no card needed. You can change plan later.'}</p></div>
    <RegisterForm products={products} initialProduct={searchParams.product && PRODUCT_NAMES[searchParams.product] ? searchParams.product : 'medical'} /><p className="muted small">{t('haveAccount', locale)} <Link href="/login">{t('login', locale)}</Link></p></div></main>;
}
