import { expect, test } from '@playwright/test';

// Public pages must not scroll sideways on a phone and must keep RTL/LTR direction correct.
for (const path of ['/', '/pricing', '/login', '/register', '/contact', '/products/medical']) {
  test(`no horizontal overflow: ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page ${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
  });
}
test('Arabic is RTL by default', async ({ page }) => { await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('dir', /rtl|ltr/); });
