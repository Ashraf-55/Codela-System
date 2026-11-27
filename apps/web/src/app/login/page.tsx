import Link from 'next/link';
import { Logo } from '@/components/Site';
import { LoginForm } from '@/components/Forms';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
export const metadata = { title: 'Log in' };
export default async function Login() {
  const locale = await getLocale();
  return <main id="main" className="auth"><div className="card stack"><Logo /><div><h1>{t('login', locale)}</h1><p className="muted small" style={{ margin: 0 }}>{locale === 'ar' ? 'أهلاً بعودتك. سجّل الدخول لإدارة نشاطك.' : 'Welcome back. Log in to run your business.'}</p></div><LoginForm /><p className="muted small"><Link href="/recover">{locale === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot your password?'}</Link></p><p className="muted small">{t('noAccount', locale)} <Link href="/register">{t('register', locale)}</Link></p></div></main>;
}
