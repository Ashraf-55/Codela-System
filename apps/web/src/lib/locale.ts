import { cookies } from 'next/headers';
import type { Locale } from './i18n';
export const getLocale = async (): Promise<Locale> => ((await cookies()).get('locale')?.value === 'en' ? 'en' : 'ar');
