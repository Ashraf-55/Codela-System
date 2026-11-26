import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './design-v2.css';
import { Providers } from '@/components/Providers';
import { getLocale } from '@/lib/locale';
import { dirOf } from '@/lib/i18n';

export const metadata: Metadata = { title: { default: 'Codela Technology', template: '%s · Codela' }, description: 'Ten specialised SaaS products — one website and one complete management system per business.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body suppressHydrationWarning><a className="skip" href="#main">Skip to content</a><Providers locale={locale}>{children}</Providers></body>
    </html>
  );
}
