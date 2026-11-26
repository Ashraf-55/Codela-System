import { describe, it, expect } from 'vitest';
import { contrastRatio } from '../src/contrast';
import { PRODUCT_THEMES, PRODUCT_SLUGS, themeToCssVars } from '../src/index';
import { dirFor, isRtl } from '../src/direction';

describe('contrastRatio', () => {
  it('black on white is 21', () => expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0));
  it('same color is 1', () => expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5));
  it('rejects invalid hex', () => expect(() => contrastRatio('red', '#fff')).toThrow());
});

describe('product themes', () => {
  it('defines exactly 10 products', () => expect(PRODUCT_SLUGS).toHaveLength(10));
  it('every product has a distinct primary color', () => {
    const set = new Set(PRODUCT_SLUGS.map((s) => PRODUCT_THEMES[s].primary.toLowerCase()));
    expect(set.size).toBe(10);
  });
  for (const slug of ['medical','realestate','ecommerce','restaurant','automotive','learning','construction','booking','fleet','business'] as const) {
    it(`${slug}: WCAG AA text contrast`, () => {
      const t = PRODUCT_THEMES[slug];
      expect(contrastRatio(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.foreground, t.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.mutedForeground, t.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.dark.foreground, t.dark.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.dark.onPrimary, t.dark.primary)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${slug}: has ar+en font stacks`, () => {
      const t = PRODUCT_THEMES[slug];
      expect(t.fonts.ar.length).toBeGreaterThan(0);
      expect(t.fonts.en.length).toBeGreaterThan(0);
    });
  }
  it('themeToCssVars emits color vars', () => {
    const css = themeToCssVars('medical');
    expect(css).toContain('--color-primary:');
    expect(css).toContain('[data-theme="dark"]');
  });
});

describe('direction', () => {
  it('ar is rtl', () => { expect(isRtl('ar')).toBe(true); expect(dirFor('ar')).toBe('rtl'); });
  it('en is ltr', () => { expect(isRtl('en')).toBe(false); expect(dirFor('en')).toBe('ltr'); });
  it('regional ar-EG is rtl', () => expect(dirFor('ar-EG')).toBe('rtl'));
});
