# Browser testing report

**Last full run: 2026-11-26, Playwright 92 tests (chromium desktop profile + Pixel 7 mobile profile), real Chromium against a real `next start` + API on a scratch SQLite database.**
Result: **91 passed, 0 failed, 0 skipped, 1 flaky** (duration 14.8 min). Raw data: `docs/qa/evidence/playwright-results.json`.

The one flaky test (`product-sites-responsive › business`) failed once with *"browser.newContext: Target page, context or browser has been closed"* — the Chromium process died on the 1-CPU / 4 GB test machine — and passed on its automatic retry (`retries: 1`). The same file failed once per full run in three earlier runs (booking, learning, business) with the same browser-closed error and passed every time when run on its own; no application error was ever seen in those failures. Treat it as an environment limit, and re-run on a bigger machine if you want it clean.

| Spec | Project | Tests |
|---|---|---|
| `a11y.spec.ts` | chromium | 11 |
| `all-products.spec.ts` | chromium | 31 |
| `estate-map.spec.ts` | chromium | 1 |
| `lead-performance.spec.ts` | chromium | 1 |
| `lesson-media.spec.ts` | chromium | 1 |
| `medical-journey.spec.ts` | chromium | 1 |
| `platform-features.spec.ts` | chromium | 14 |
| `product-sites-responsive.spec.ts` | chromium | 10 |
| `quotations.spec.ts` | chromium | 1 |
| `responsive.spec.ts` | chromium | 7 |
| `responsive.spec.ts` | mobile | 7 |
| `security-and-isolation.spec.ts` | chromium | 4 |
| `site-builder.spec.ts` | chromium | 3 |

## What the browser tests cover
- **All ten products** (`all-products`): public site renders without script errors, owner dashboard + logout, CRUD through the API with the dashboard session, tenant isolation between two businesses of the same product.
- **Responsive / navigation** (`product-sites-responsive`, chromium): each product's published site and dashboard at 1280 / 820 / 390 px — no horizontal overflow on the site, no sideways scroll on the dashboard, every menu link checked (anchor target exists or page answers < 400), one anchor clicked, mobile menu opened. `responsive` (Pixel 7 profile): platform pages overflow + RTL by default.
- **Accessibility** (`a11y`): axe-core WCAG 2.0/2.1 A + AA on every product — no violations (`docs/ACCESSIBILITY_REPORT.md`).
- **Website builder** (`site-builder`): drag-and-drop order persisted and published, per-page slugs (duplicates / reserved / format), image cropping to a stored square image.
- **Product features**: medical journey and lab/pharmacy screens, Estate map + lead performance, Learn video upload (12 MB through the web proxy, Range 206, paid-only) and material download, Business quotations, Fleet / Auto / Build / Estate / Learn specialised screens load, security & isolation (lock-out, disguised upload rejected, protected routes).

## Fixed because of the browser runs
Page title carried "· Codela" on tenant sites; the web proxy dropped `Range` and truncated uploads over 10 MB; a 416 response hung; dashboard had no `<main>`; site menu linked to sections that did not exist; five contrast / aria issues; spec errors (fonts offline, wrong endpoint, login races).

## Not covered / limits
Tablet is covered only by `product-sites-responsive` (820 px, Chromium desktop engine, not a tablet device profile). Not run: Firefox, WebKit/Safari, real phones, screen readers. OpenStreetMap tiles could not load offline (markers / popups tested). The video test used a synthetic MP4 (server delivery verified, not codec playback). External services (card gateway, e-mail / SMS / WhatsApp, DNS / SSL, backups, monitoring) cannot be tested without real accounts.
Test-only switches: `E2E_RELAX_RATE_LIMITS=1`, `E2E_CHROMIUM_PATH`, `E2E_NO_VIDEO` (see `.env.example`, `docs/E2E.md`).
