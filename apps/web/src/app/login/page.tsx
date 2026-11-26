import Link from 'next/link';
import { LoginForm } from '@/components/Forms';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
export const metadata = { title: 'Log in' };
export default async function Login() {
  const locale = await getLocale();
  return <main id="main" className="auth"><div className="card stack"><Link href="/" className="logo">codela<i>.</i></Link><h2>{t('login', locale)}</h2><LoginForm /><p className="muted small"><Link href="/recover">{locale === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot your password?'}</Link></p><p className="muted small">{t('noAccount', locale)} <Link href="/register">{t('register', locale)}</Link></p></div></main>;
}
