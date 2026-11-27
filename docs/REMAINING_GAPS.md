# Remaining gaps (updated 2026-11-27, seventh pass)

Verification of this pass: lint + typecheck clean · vitest 62 files / 518 tests · `next build` OK · Playwright **99 passed, 0 failed, 0 flaky, 0 skipped (2026-11-27)** · axe clean · `npm audit --omit=dev` 0 vulnerabilities.

## Closed in this pass
Subscription catch-up bug (stale full-access request) · Super Admin unreachable on phones · duplicate sidebar links · misleading pricing ticks · click-only sortable headers · RTL page widening from off-screen skip link/honeypots · 10 failing/flaky browser tests (root-caused, see BROWSER_TESTING_REPORT) · premium redesign (DESIGN_SYSTEM.md).

## Still open
| Item | Type | Notes |
|---|---|---|
| Card gateway (Paymob live), e-mail / SMS / WhatsApp providers, DNS + wildcard TLS, Sentry, off-site backups, uptime monitoring | external credentials / infrastructure | code paths exist; see ENVIRONMENT_SETUP.md, DEPLOYMENT.md, `.env.example` |
| Automatic monthly card charging | needs gateway tokenisation on the merchant account | renewal = reminder + manual / sandbox payment |
| Ordering from inside the customer account (e-commerce / restaurant) | feature | the account links to the website ordering pages |
| Firefox / WebKit / real devices; screen-reader walkthrough | test coverage | Chromium desktop + Pixel 7 emulation only; axe is automated, not a human audit |
| Existing tenants' stored Arabic hero titles may show a Latin business name with mis-ordered punctuation | content | new sites isolate the name; owners can edit the title in the website builder |
| Product display fonts load from Google Fonts | hosting choice | UI faces are self-hosted; self-host the ten display faces if the CDN is not allowed |
| Order-tracking card on some public sites stretches to the height of the neighbouring booking form | cosmetic | layout only |
| External penetration test | process | internal review only (SECURITY.md) |

---
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
