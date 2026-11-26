'use client';
import { TwoFactor } from '@/components/TwoFactor';
import { useI18n } from '@/components/Providers';

export default function AdminSecurity() {
  const { locale } = useI18n();
  return <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{locale === 'ar' ? 'الأمان' : 'Security'}</h1><TwoFactor scope="platform" locale={locale} /></>;
}
