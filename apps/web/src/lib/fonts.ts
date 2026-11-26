import { PRODUCT_THEMES, type ProductSlug } from '@codela/design';
/** Google Fonts stylesheet for a product's Arabic + Latin faces (400/700 exist for every face we use, so the request cannot fail on a weight). Falls back to system fonts when offline. */
export function fontsHref(slug: string): string {
  const t = PRODUCT_THEMES[slug as ProductSlug] ?? PRODUCT_THEMES.business;
  const fam = [...new Set([t.fonts.ar[0], t.fonts.en[0]])].map((f) => `family=${f.replace(/ /g, '+')}:wght@400;700`).join('&');
  return `https://fonts.googleapis.com/css2?${fam}&display=swap`;
}
