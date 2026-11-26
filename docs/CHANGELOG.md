# CHANGELOG
## 0.1.0 — first complete engineering build
* Platform: multi-tenant auth/RBAC/CSRF, subscriptions + entitlements + add-ons, billing records with gateway boundary + signed webhooks, white-label sites + DNS-verified domains, global search, notifications + outbox, Super Admin (tenants, plans, analytics, leads, tasks, settings, staff).
* Ten tested product backends: Medical, Real Estate, E-Commerce, Restaurant, Automotive, Learning, Construction, Booking, Fleet & Delivery, Business.
* Web: marketing site (ar/en, RTL/LTR, light/dark), onboarding, schema-driven tenant dashboards for all products, billing/site/domain/team/settings/outbox pages, Super Admin UI, server-rendered tenant websites.
* Quality: 340+ automated tests, ESLint clean, strict TypeScript, production build, HTTP smoke test, dependency audit (0 prod vulnerabilities).
* Known gaps: see FINAL_REPORT.md.

## Unreleased — fixes from the engineering audit (2026-11-10)
- **Security:** `trust proxy` is no longer `true` (fixes ERR_ERL_PERMISSIVE_TRUST_PROXY). New `apps/api/src/trust-proxy.ts` (default `loopback`, hop counts, CIDRs; rejects `true`/`*`). The Next.js API proxy no longer relays the browser's X-Forwarded-For; it derives one client IP from `WEB_TRUST_PROXY_HOPS` (`apps/web/src/lib/client-ip.ts`).
- **Tooling:** `npm run create-admin` works (workspace script added); friendly errors for duplicate admin / invalid input.
- **Next.js 16:** `middleware.ts` renamed to `proxy.ts` (deprecation warning). `allowedDevOrigins` added for dev HMR WebSocket; `tsconfig.tsbuildinfo` removed from the repo and git-ignored.
- **Tests added (not yet run in CI — no network in the authoring sandbox):** `apps/api/test/trust-proxy.test.ts`, `apps/web/test/client-ip.test.ts`.
- **Hydration (`cz-shortcut-listen`):** attribute is injected by the ColorZilla browser extension; the app never emits it (searched the whole source). No suppression added.
- **Added (untested end-to-end, see docs):** Paymob gateway + HMAC callback + refund state (`docs/PAYMENTS.md`); Resend/Twilio/WhatsApp adapters, 8 bilingual templates, retry worker (`docs/NOTIFICATIONS.md`); secure uploads with magic-byte validation, quota, tenant isolation (`uploads.ts`, `file-validation.ts`); portal accounts, verification, password reset, "my records" + UI (`docs/PORTAL.md`); migration `0008_portal_files` (tables `portal_accounts`, `portal_sessions`, `files`).
- **Added (second pass):** per-product work boards `/app/board` (medical/booking today's appointments + waiting room, restaurant kitchen display, e-commerce order pipeline, fleet shipment board, automotive workshop board) driven by real records and server-enforced transitions; logo upload in the website editor (`logoUrl` accepts an uploaded public-file path); e-mail triggers for order status changes and payment confirmations/failures; appointment reminder scheduler (`reminders.ts`, hourly in the outbox worker, tenant time zone, idempotent).
- **Third pass:** boards for all 10 products; portal course enrolment; record attachments (migration `0009_file_links`, permission = parent record, UI on every record page); notification preferences (migration `0010_notify_prefs`, settings UI, `opted_out` status); subscription renewal notices; `npm run backup` + `/api/v1/ready`; proxy fixes (file name + download headers); portal cookie collision fix (`cust_sid`/`cust_csrf`); CSP subset + HSTS; docs `PRODUCTION.md`, `SECURITY_AUDIT.md`.
- **Fourth pass:** staff/admin/customer lock-out + TOTP 2FA (migration `0011_login_security`, `totp.ts` verified against RFC 6238 vectors); delivery tracking + Twilio/WhatsApp receipt webhooks (migration `0012_delivery_tracking`); status notifications for booking/automotive/fleet/restaurant; portal booking + appointment request; uploaded product images in forms; Playwright suite in `e2e/` (separate package); opt-in strict CSP; renewal links.

- **Fifth pass (2026-11-12) — written WITHOUT being able to run `npm ci` / tests (no network in the authoring sandbox). Run `npm run check` first.**
  - **Account recovery for owners/staff:** `/recover` page, `POST /auth/forgot-password | reset-password | verify-email | resend-verification` (`account-recovery.ts`), migration `0013_account_recovery` (`users.email_verified_at`, existing users back-filled), `enqueueSystem` (ignores notification preferences), optional enforcement `STAFF_REQUIRE_EMAIL_VERIFICATION=1`.
  - **Student portal:** lesson viewer, progress, live sessions, exams, assignments, certificate request (`portal-learning.ts`); new entities `assignment` + `submission` in the learning product.
  - **Customer portal:** notifications list, payment history, profile picture (also for owners/staff: migration `0014_avatars`, `avatars.ts`, `/auth/me/avatar`, settings UI).
  - **Database audit (phase 10):** all 16 migrations applied and inspected; 13 missing indexes added (`0015_integrity_indexes`); `schema-integrity.test.ts`; `docs/DATABASE_AUDIT.md`; drizzle snapshots 0013–0015.
  - **Delivery receipts for e-mail:** Resend webhook with Svix signature verification.
  - **Monitoring:** Sentry-protocol reporter in `packages/shared/src/sentry.ts` (API 5xx + crash handlers + Next `instrumentation.ts`), off without `SENTRY_DSN`.
  - **Deployment files:** `Dockerfile`, `docker-compose.yml` (api + web + Caddy), `deploy/Caddyfile`, `deploy/ecosystem.config.cjs` (pm2), `deploy/systemd/*` (+ nightly backup timer).
  - **Tooling:** `npm run audit:prod` (the plain `npm audit` fails on `registry.npmmirror.com`, which has no audit endpoint); `PUBLIC_WEB_URL` now also drives the e-mailed account links; the API proxy accepts `?site=` for `<img>` URLs.


## 2026-11-20 — Commerce merge and gap closing
- Merged the storefront/board pass with profit, low stock, payments, exchanges, policies; dashboard quick actions and getting-started checklist; docs DATABASE, SUBSCRIPTIONS_AND_BILLING, IMPLEMENTATION_PROGRESS.

## 2026-11-24
- Added: default public-site copy for all products; builder SEO/hours/team/gallery/theme; `site` upload purpose; `approve`/`export` permissions and CSV export; custom roles; add-on lifecycle (migration 0019); announcements, notification templates, customer detail and manual subscription actions in Super Admin; pharmacist / lab / radiology screens; lab & imaging results in patient portal; medication batch/expiry; booking refunds; driver GPS + offline queue; server-side store paging in the UI.
- Fixed: 4 completion tests used 2-character slugs; pharmacist test omitted the required `sku`.
