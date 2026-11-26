export type Locale = 'ar' | 'en' | (string & {});
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

export function isRtl(locale: Locale): boolean {
  return RTL.has(locale.toLowerCase().split('-')[0]);
}
export function dirFor(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}
