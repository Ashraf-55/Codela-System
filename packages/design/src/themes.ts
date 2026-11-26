export const PRODUCT_SLUGS = [
  'medical', 'realestate', 'ecommerce', 'restaurant', 'automotive',
  'learning', 'construction', 'booking', 'fleet', 'business',
] as const;
export type ProductSlug = (typeof PRODUCT_SLUGS)[number];

export interface ModeColors {
  background: string; foreground: string; primary: string; onPrimary: string;
}
export interface ProductTheme {
  primary: string; onPrimary: string; accent: string; onAccent: string;
  background: string; foreground: string; mutedForeground: string;
  fonts: { ar: string[]; en: string[] };
  radius: string; // per-product shape language
  dark: ModeColors;
}

const f = (ar: string, en: string) => ({
  ar: [ar, 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
  en: [en, 'system-ui', 'sans-serif'],
});

export const PRODUCT_THEMES: Record<ProductSlug, ProductTheme> = {
  medical: { primary: '#0E7490', onPrimary: '#FFFFFF', accent: '#15803D', onAccent: '#FFFFFF',
    background: '#F0F9FA', foreground: '#0F2A33', mutedForeground: '#4B6670', radius: '10px',
    fonts: f('IBM Plex Sans Arabic', 'IBM Plex Sans'),
    dark: { background: '#0A1A20', foreground: '#E6F4F7', primary: '#22D3EE', onPrimary: '#042F3A' } },
  realestate: { primary: '#134E4A', onPrimary: '#FFFFFF', accent: '#B45309', onAccent: '#FFFFFF',
    background: '#F7F5EF', foreground: '#1C2B29', mutedForeground: '#55625F', radius: '4px',
    fonts: f('Noto Kufi Arabic', 'Fraunces'),
    dark: { background: '#0F1A19', foreground: '#EEF3F1', primary: '#5EEAD4', onPrimary: '#042F2E' } },
  ecommerce: { primary: '#6D28D9', onPrimary: '#FFFFFF', accent: '#C2410C', onAccent: '#FFFFFF',
    background: '#FAF8FF', foreground: '#1E1633', mutedForeground: '#5B5470', radius: '14px',
    fonts: f('Readex Pro', 'DM Sans'),
    dark: { background: '#140F24', foreground: '#F1ECFF', primary: '#A78BFA', onPrimary: '#1E1033' } },
  restaurant: { primary: '#92400E', onPrimary: '#FFFFFF', accent: '#B91C1C', onAccent: '#FFFFFF',
    background: '#FFF8EC', foreground: '#2B1810', mutedForeground: '#6B4F3F', radius: '18px',
    fonts: f('El Messiri', 'Playfair Display'),
    dark: { background: '#1C120C', foreground: '#FBEFE0', primary: '#FBBF24', onPrimary: '#3B1D06' } },
  automotive: { primary: '#1E293B', onPrimary: '#FFFFFF', accent: '#DC2626', onAccent: '#FFFFFF',
    background: '#F4F5F7', foreground: '#111827', mutedForeground: '#4B5563', radius: '2px',
    fonts: f('Cairo', 'Barlow Condensed'),
    dark: { background: '#0B0F17', foreground: '#F3F4F6', primary: '#E2E8F0', onPrimary: '#0F172A' } },
  learning: { primary: '#0F766E', onPrimary: '#FFFFFF', accent: '#B45309', onAccent: '#FFFFFF',
    background: '#F2FAF8', foreground: '#10302C', mutedForeground: '#3F6560', radius: '12px',
    fonts: f('Tajawal', 'Nunito Sans'),
    dark: { background: '#0A1C1A', foreground: '#E8F7F4', primary: '#2DD4BF', onPrimary: '#042F2E' } },
  construction: { primary: '#475569', onPrimary: '#FFFFFF', accent: '#C2410C', onAccent: '#FFFFFF',
    background: '#F6F5F2', foreground: '#1F2328', mutedForeground: '#5A6068', radius: '0px',
    fonts: f('Almarai', 'Archivo'),
    dark: { background: '#14161A', foreground: '#F1F2F4', primary: '#CBD5E1', onPrimary: '#1E293B' } },
  booking: { primary: '#BE185D', onPrimary: '#FFFFFF', accent: '#7C3AED', onAccent: '#FFFFFF',
    background: '#FFF5F9', foreground: '#2A1020', mutedForeground: '#6B4558', radius: '20px',
    fonts: f('Readex Pro', 'Manrope'),
    dark: { background: '#1B0C14', foreground: '#FDEBF3', primary: '#F9A8D4', onPrimary: '#4A0D28' } },
  fleet: { primary: '#1D4ED8', onPrimary: '#FFFFFF', accent: '#C2410C', onAccent: '#FFFFFF',
    background: '#F1F5FD', foreground: '#0F1B3D', mutedForeground: '#4A5778', radius: '6px',
    fonts: f('Cairo', 'Space Grotesk'),
    dark: { background: '#0A1226', foreground: '#E8EEFC', primary: '#93C5FD', onPrimary: '#0B1E4A' } },
  business: { primary: '#4338CA', onPrimary: '#FFFFFF', accent: '#047857', onAccent: '#FFFFFF',
    background: '#F5F5FB', foreground: '#1A1B3A', mutedForeground: '#53557A', radius: '8px',
    fonts: f('IBM Plex Sans Arabic', 'Inter Tight'),
    dark: { background: '#0E0F24', foreground: '#EDEDFB', primary: '#A5B4FC', onPrimary: '#1E1B4B' } },
};
