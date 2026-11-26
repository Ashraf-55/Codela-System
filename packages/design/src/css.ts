import { PRODUCT_THEMES, type ProductSlug } from './themes';

/** Emit CSS custom properties for a product (light default + dark override). */
export function themeToCssVars(slug: ProductSlug): string {
  const t = PRODUCT_THEMES[slug];
  return [
    `:root{`,
    `--color-primary:${t.primary};--color-on-primary:${t.onPrimary};`,
    `--color-accent:${t.accent};--color-on-accent:${t.onAccent};`,
    `--color-background:${t.background};--color-foreground:${t.foreground};`,
    `--color-muted-foreground:${t.mutedForeground};--radius:${t.radius};`,
    `--font-ar:${t.fonts.ar.map((x) => `"${x}"`).join(',')};`,
    `--font-en:${t.fonts.en.map((x) => `"${x}"`).join(',')};}`,
    `[data-theme="dark"]{`,
    `--color-primary:${t.dark.primary};--color-on-primary:${t.dark.onPrimary};`,
    `--color-background:${t.dark.background};--color-foreground:${t.dark.foreground};}`,
  ].join('\n');
}
