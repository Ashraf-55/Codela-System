# Seventh-pass report (2026-11-27) — read this first

## Verification (all run in this pass, fresh, on the final code)
| Check | Result |
|---|---|
| `npm run lint` · `npm run typecheck` | clean |
| `npm test` (vitest) | **62 files / 518 tests passed** (516 before + 2 new regression tests) |
| `npm run build` (Next production) | OK |
| Playwright, real Chromium vs `next start` + API | **99 passed, 0 failed, 0 flaky, 0 skipped (2026-11-27)** |
| axe-core (WCAG 2.0/2.1 A+AA), all ten products + platform pages | **no serious/critical violations** |
| `npm run audit:prod` | **0 vulnerabilities** |

**Baseline found at the start of this pass** (same commands, unchanged code): lint/typecheck/vitest/build green, but **Playwright 82 passed / 10 failed / 1 flaky**. The previous report's "91 passed, 0 failed" did not reproduce. Root causes and fixes are in `BROWSER_TESTING_REPORT.md`.

## Classification
| Category | Items |
|---|---|
| **Implemented and verified (automated)** | design system v3 + redesigned dashboard shell, Super Admin shell, marketing site, record list/detail/new screens, all ten product identities (browser + axe) · subscription catch-up fix (vitest) · admin phone navigation, confirm dialog, toasts, keyboard search, nav de-duplication (`e2e/tests/ui-shell.spec.ts`) · every flow listed in `BROWSER_TESTING_REPORT.md` |
| **Implemented, not externally verified** | product display fonts from Google Fonts (offline fallback verified, live CDN not); bidi isolation of the business name in newly generated Arabic site copy (unit-tested; existing sites keep their stored text) |
| **Simulated** | payment gateway = sandbox; e-mail/SMS/WhatsApp = outbox with `simulated`/`no_provider` statuses (unchanged; never reported as delivered) |
| **Blocked by credentials / infrastructure** | Paymob live keys, Resend/Twilio/WhatsApp keys, DNS + wildcard TLS, Sentry DSN, off-site backups, monitoring — see `ENVIRONMENT_SETUP.md`, `DEPLOYMENT.md` |
| **Still incomplete** | see `REMAINING_GAPS.md` (Firefox/WebKit/real devices, screen-reader pass, automatic card renewal, in-account ordering, external pen-test) |

## What changed in this pass
**Critical / data-integrity**
* `tick()` (subscription state machine) applied one transition per call: an *active* subscription first seen after both its period end and its grace end became `past_due` (= full write access) for one request before turning `suspended`. It now catches up in one call. Regression tests in `packages/shared/test/subscription.test.ts`.

**Broken functionality fixed**
* Super Admin had no menu button below the mobile breakpoint, so its navigation was unreachable on phones.
* Duplicate sidebar links (registry boards + hand-written entries share an href; duplicate React keys multiplied them on re-render: Real Estate showed "Leads pipeline / Viewings" three times).
* Ambiguous labels: Business "Quotations" (editor) vs "Quotations" (board) → "Quotation editor".
* Pricing marked unavailable features ("Custom domain — No") with a green tick; now shown as unavailable.
* Sortable table headers were click-only (not keyboard reachable); now buttons with `aria-sort`.
* Skip link and honeypot inputs were pushed 999–9 999 px off-screen, widening RTL pages; now clipped in place.

**Premium redesign** — see `DESIGN_SYSTEM.md`: tokens (light/dark/OS), self-hosted UI fonts (Plus Jakarta Sans + IBM Plex Sans Arabic), inline icon set, buttons/inputs/selects/tables/badges/alerts/tabs/empty states/skeletons/toasts/dialogs, redesigned tenant dashboard (icon navigation, filterable records, account menu, ⌘K search, greeting + KPI tiles + reports), redesigned record screens (breadcrumbs, status workflow bar, empty states, accessible form errors), redesigned marketing home/header/footer/auth, refined identities for all ten products' dashboards and public sites. `window.confirm` replaced by an accessible dialog in all 11 places.

**Tests** — 2 vitest, 6 new browser tests (`ui-shell.spec.ts`), and 4 broken specs repaired without weakening them (details in `BROWSER_TESTING_REPORT.md`).

## Tooling audit (development-agent resources, not product dependencies)
| Repository | What it provides | How it was used here |
|---|---|---|
| DietrichGebert/ponytail | "smallest complete change" engineering rules (`AGENTS.md`, review/audit/debt skills) | Applied as the working rule: no new abstractions; reuse `fmtMoney`, existing class vocabulary and routes; the only new dependencies are two self-hosted font packages; shortcuts documented in code |
| anthropics/claude-plugins-official | plugins incl. `frontend-design`, `security-guidance`, `code-review`, `pr-review-toolkit`, `feature-dev` | `frontend-design` SKILL guided the redesign (token plan, one memorable element = live product preview, avoiding generic AI-design tells, critique via screenshots). `security-guidance` review classes (IDOR, XSS, auth bypass, path traversal, secrets) used as the audit checklist. Plugins were read, not installed into the product |
| thedotmack/claude-mem | persistent memory via a local worker service + hooks | Not installable usefully in an ephemeral cloud container (needs a long-running worker and per-machine state). Its purpose — no lost decisions between sessions — is served by `docs/PROGRESS.md` + commits |
| obra/superpowers | brainstorming, writing-plans, TDD, systematic-debugging, verification-before-completion, code review | TDD (red → green on the subscription bug), systematic debugging (every failing spec traced to a root cause before changing it), verification-before-completion (every number above comes from a fresh run) |
| Ashraf-55/Codela-System | the product | worked in place on branch `claude/seventh-pass-redesign`; the uploaded `codela_v18_final.zip` matched the repository (only an empty `public/` and local build files differed) |

No agent tooling was added to the application.

---
# Sixth-pass summary (2026-11-26) — read this before the older text below

| Category | Items |
|---|---|
| **Implemented and verified automatically (browser)** | per-page SEO slugs · drag-and-drop section order · image cropping · Estate map + lead-performance screen · Learn hosted video + material download · Business quotations screen · all-ten-product site/dashboard responsive + menu-link checks · axe-core accessibility audit |
| **Verified automatically (API / vitest, 516 tests)** | refunds, Fleet payments, portal payment requests (previous pass) · video upload validation / authorization / Range · lead reports · Med visits (`medicalRecord`) · tenant isolation |
| **Verified manually by the owner** | the screens of the earlier passes (owner report) — not re-verified by me |
| **Not tested** | Firefox / WebKit / real devices · screen readers · OpenStreetMap tiles online · real video playback · XSS payloads on map popups / extra pages · external penetration test |
| **Externally dependent (code ready, no credentials)** | card gateway · e-mail · SMS · WhatsApp · DNS · SSL · backups · monitoring (`docs/ENVIRONMENT_SETUP.md`, `docs/DEPLOYMENT.md`, `.env.example`) |
| **Remaining limitations** | one flaky Playwright journey on a 1-CPU machine (passes on retry) · web proxy buffers uploaded videos in memory (≤ 150 MB) · `docs/REMAINING_GAPS.md` |

Evidence: `docs/BROWSER_TESTING_REPORT.md`, `docs/ACCESSIBILITY_REPORT.md`, `docs/SECURITY_AUDIT.md` (addendum), 20 `docs/ACCEPTANCE_<product>_{website,management}.md`.

---
# FINAL ENGINEERING REPORT — Codela (v0.2, fifth pass)

> **Read this first.** The user ran the previous builds locally: `npm ci`, lint, typecheck, build and the test suite passed (375/375 on the last full run they reported, after the three fixes in `codela-fixes.zip`), and they exercised the app in a browser. **Everything listed under "Fifth pass" below was written in an environment without network access, so `npm ci`, the TypeScript compiler, ESLint, Vitest, Next and a browser were NOT available. That code has never been compiled or tested as a whole.** Only the parts marked "executed" were run (with plain Node / SQLite). Run `npm run check` before trusting any of it, and send the first error you see.

## 1. What exists (carried over, verified earlier by the user)
Ten industry products on one multi-tenant core (auth, RBAC, CSRF, tenant isolation, subscriptions + entitlements + add-ons, billing with Paymob + signed webhooks, white-label sites + domains, global search, notification outbox with Resend / Twilio / WhatsApp adapters, uploads with magic-byte validation, customer portal, board screens for all products, lock-out + TOTP 2FA, backups, readiness endpoint). See README.md, ARCHITECTURE.md, SECURITY.md, PAYMENTS.md, NOTIFICATIONS.md, PORTAL.md.

## 2. Fifth pass — what was added
| Area | Change | State |
|---|---|---|
| Owner/staff account recovery | `/recover`, forgot/reset/verify/resend endpoints, migration 0013, optional login enforcement | tests written, **not run** |
| Student portal | lesson viewer, progress, live sessions, exams, assignments, certificate request; new `assignment` + `submission` entities | tests written, **not run** |
| Customer portal | notifications list, payment history, profile picture (customers + staff, migration 0014) | tests written, **not run** |
| Database audit | 16 migrations applied in SQLite, FK check clean, 13 indexes added (migration 0015), integrity test, `DATABASE_AUDIT.md`, snapshots | migrations + audit **executed**; vitest file **not run** |
| E-mail delivery receipts | Resend webhook, Svix signature, no downgrade, opens ignored | signature logic **executed**; endpoint test **not run** |
| Error monitoring | Sentry-protocol reporter (API, crash handlers, Next instrumentation), off without DSN | reporter **executed** (all assertions); live Sentry **not verified** |
| Deployment | Dockerfile, compose (api + web + Caddy), Caddyfile, pm2, systemd + backup timer | YAML/JS syntax checked; **never built or started** |
| Tooling | `npm run audit:prod` (the `npm audit` error was the npmmirror registry, not the project) | explained |

## 3. The `npm audit` error
`npm warn audit 404 … registry.npmmirror.com … NOT_IMPLEMENTED`: your npm is configured with the npmmirror registry, which has no security-advisory endpoint. Nothing is wrong with the project. Run `npm run audit:prod` (forces registry.npmjs.org) and read the result yourself; the previous zero-vulnerability claim dates from the first build.

## 4. Still NOT done (stated plainly)
* **Automatic monthly card charging** — needs Paymob tokenisation on your merchant account; renewal today = e-mail + manual payment.
* **Ordering from inside the customer account** (e-commerce / restaurant) — the account links to the website pages. Not built.
* **Platform-staff self-service password reset** — no tenant outbox to send through; create a replacement admin with `npm run create-admin`.
* **Exam timer** is informational (no server-side time limit). **Video hosting** — lessons link to external URLs.
* **Browser testing** — the Playwright suite in `e2e/` has never been run by me; no screenshot / responsive review was done in this pass.
* **Live providers** — Paymob, Resend, Twilio, WhatsApp, Sentry, DNS/TLS: nothing verified live. Wildcard HTTPS for tenant subdomains needs the DNS-challenge setup described in `deploy/Caddyfile`.
* The phase-9 security audit was not repeated as a new full review; only the new endpoints were designed against it (tenant-scoped lookups, CSRF on every write, no answers/links/secrets in responses, strict zod bodies, hooks reused so business rules cannot be bypassed).
* Several items of the master prompt were not re-done because they were already complete or cannot be done without access (see sections 1 and 4).

## 5. How to take this build
1. Extract over your existing folder (keep your `.env` and `data/`). Migrations 0013–0015 apply automatically on the next API start and are additive (no data is dropped).
2. `npm ci` → `npm run check`. Expect possible compile or test failures in the new files; send me the first error.
3. Run: `npm run dev:api` and `npm run dev:web`. New things to click: `/login` → "Forgot your password?", `/app/settings` (profile picture), the customer portal (`/sites/<slug>/portal`: payments, notifications, picture, and for a learning tenant: lessons / exams / assignments).
4. For learning: create a course with lessons, an exam with questions, an assignment (dashboard: Assignments), enrol a student whose e-mail matches a portal account, record a payment (or use a free course), then walk through the portal.


## Addendum 2026-11-24 (Implemented / Tested / Verified / Externally dependent)
- **Implemented:** see `docs/REMAINING_GAPS.md` ("Done in this pass").
- **Tested:** `npm run check` — eslint, TypeScript (api + web), 60 files / 510 vitest tests, `next build` all pass. New API tests: site-builder, governance (roles / export / approve), addon-lifecycle (fake clock), platform-extras, portal-results, booking refunds, driver GPS.
- **Verified:** public sites of all 10 products rendered by a real `next start` against a real API (HTTP 200, about/services/hours present). **Frontend + backend in a browser: NOT verified.**
- **Externally dependent:** card gateway, e-mail/SMS/WhatsApp provider, DNS/SSL, backups & monitoring.
Not production-ready until the Playwright suite has been run and the gaps in `REMAINING_GAPS.md` are closed.

### Second-pass addendum 2026-11-24
Implemented: customer-payment refunds + Fleet + portal list; Business stock per warehouse; Learn rating aggregate; Auto work-order and warranty screens; Build estimates/printable claims; Estate commissions, contracts, compare, per-property URL; Fleet driver-cash screen; Learn course builder; 20 split acceptance reports.
Tested: `npm run check` ✅ (513 tests). Verified over real HTTP: property page (200 + 404), all new routes reachable. **Not verified in a browser.** Open items: `docs/REMAINING_GAPS.md`.
