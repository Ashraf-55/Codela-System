# Remaining gaps (updated 2026-11-26, sixth pass)

Verification of this pass: `npm run lint` clean · `typecheck` clean · **vitest 62 files / 516 tests** · `next build` OK · **Playwright 91 passed + 1 flaky (passed on retry), 0 failed** in one full run (chromium + Pixel 7 profile) — `docs/BROWSER_TESTING_REPORT.md`. axe-core: no violations — `docs/ACCESSIBILITY_REPORT.md`.

## Done in this pass (all browser- or API-tested)
Per-page SEO slugs · drag-and-drop section order · image cropping · Estate map (Leaflet / OpenStreetMap, coordinates optional, validated) · Estate lead-performance screen + 6 reports · Learn hosted video upload (streamed, 150 MB, Range) + material download · Business quotations screen · Playwright executed for all ten products, desktop / tablet / mobile · automated accessibility audit · 20 acceptance reports re-stamped from the real run (`scripts/update-acceptance.py`).
Phase 6 verifications: Med **Visits = `medicalRecord`** (required links, newest first, tenant isolation, staff restriction: API test) · Estate lead report (was missing, implemented) · Learn material download (implemented + tested) · Fleet customer invoice payments (delivered in the previous pass; its API tests still pass, not re-verified in a browser).

## Still open
- **Externally dependent (not code):** card-gateway credentials, e-mail / SMS / WhatsApp providers, DNS + SSL, backup and monitoring infrastructure.
- Browsers: Firefox / WebKit / real devices and screen readers were not run. Tablet = 820 px in Chromium only.
- OpenStreetMap tiles not verifiable offline; hosted-video test used a synthetic MP4.
- The web proxy buffers an uploaded video (≤ 150 MB) in memory before forwarding it.
- One Playwright journey (`product-sites-responsive`) is flaky on a 1-CPU / 4 GB machine (browser process dies); it passes on retry.
- No dedicated XSS payload test for the map popups / extra pages (reviewed in code only). No external penetration test.
- Acceptance reports map evidence to criteria by test title: read the listed tests, they are not a line-by-line proof.
