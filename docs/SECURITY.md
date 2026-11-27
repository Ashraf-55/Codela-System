# SECURITY — seventh-pass review (2026-11-27)

Re-verified against the code (not the documents): session tokens stored as SHA-256 only, httpOnly cookies, HMAC double-submit CSRF on every authenticated write, tenant taken only from the server-side session or a verified host, every record query filtered by `tenant_id` (`getRecord`, `listRecords`, `findWhere`), per-entity permission checks on read/create/update/delete/approve/export, CSV formula-injection neutralised, LIKE wildcards escaped, JSON field paths bound as parameters, uploads validated by magic bytes (SVG/HTML/XML/scripts rejected) and served with `nosniff` + `CSP: sandbox`, no `dangerouslySetInnerHTML` in the web app, map popups built with `textContent`, rate limits on auth / public forms / global, conservative CSP + HSTS in production, strict nonce CSP opt-in (`CSP_STRICT=1`).

Findings this pass:
| Severity | Finding | Fix |
|---|---|---|
| High (data integrity / authorisation) | lapsed subscriptions got one write-capable request (`tick` single-step) | catch-up + tests |
| Low | business name in Arabic copy could reorder surrounding text (spoof-looking headings) | Unicode isolates |

`npm audit --omit=dev`: 0 vulnerabilities. The two new runtime dependencies are font files only (`@fontsource-variable/plus-jakarta-sans`, `@fontsource/ibm-plex-sans-arabic`, OFL). Not done: external penetration test.

---
# SECURITY

## Implemented controls (each is covered by tests unless noted)
* **Passwords**: bcrypt cost 12; policy ≥ 10 chars with letters+digits; equal-cost dummy comparison for unknown users (no user enumeration; identical 401 message).
* **Sessions**: 256-bit random token, only its SHA-256 is stored; httpOnly + SameSite (lax for tenants, strict for staff) + `Secure` in production; 7-day tenant / ≤ 12 h staff sessions; logout deletes the row; suspended users/tenants lose access immediately.
* **CSRF**: HMAC(session token) double-submit on every authenticated mutating request (tested 403 without it). Public endpoints are unauthenticated by design and cannot act on a session.
* **Authorization**: backend RBAC (`module.action` permissions; `*` and `module.*` grants); record-level privacy for medical/HR data (`sensitive` entities audit every read); frontend visibility is cosmetic only. A sweep test proves every protected route returns 401 anonymously.
* **Tenant isolation**: see TENANT_ARCHITECTURE.md (generated cross-tenant sweep over all 10 products).
* **Input**: zod validation on every route; entity framework validates types, enums, money as integers, dates, phones (Arabic-Indic digits normalised); unknown/readonly fields are dropped (no mass assignment); LIKE patterns escaped; Drizzle uses bound parameters (no string-built SQL with user data).
* **Output**: React escapes by default; tenant content is rendered as text; branding URLs must be `https://`, colours `#rrggbb`; no secrets or stack traces in errors (500 → generic message).
* **Abuse**: global + auth + public-form rate limits; honeypot on public forms; body size limit 1 MB (256 KB for webhooks).
* **Webhooks**: HMAC-SHA256 signature verified with constant-time compare; idempotent by `(provider, eventId)`; unverified providers (`paymob`) are rejected with 501, never trusted.
* **Headers**: helmet on the API; the web app sets `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
* **Audit**: tenant and platform audit logs for logins, creates/updates/deletes, plan/status changes, sensitive reads (no passwords/tokens stored).
* **Secrets**: only via environment; `CSRF_SECRET` is mandatory in production; admin bootstrap reads credentials from env, none hardcoded (secret scan of the repo is clean).
* **Data safety**: lapsed subscriptions never delete data; currency is locked once financial data exists; ledgers (stock, payments, ledger entries, tracking events) are append-only.

## Dependency audit (`npm audit`, run during this build)
Production dependencies: **0 vulnerabilities**. Dev tooling: 11 *moderate* advisories remain (esbuild dev-server CORS via drizzle-kit's legacy `esbuild-kit`, minimatch ReDoS via typescript-eslint) — build/lint tools only, not shipped. Re-run `npm audit` before each release.

## Known gaps / risks (not hidden)
* No file uploads exist (logos are https URLs) — safe-upload handling was therefore not built.
* No account lockout / MFA / password reset / email verification (rate limiting only). Needs an email provider.
* No CSP header on the web app (the design-token `<style>` is inline); add a nonce-based CSP before production.
* `SameSite=Lax` cookies + CSRF token only; no origin check beyond that.
* SQLite is single-writer; no encryption at rest (use disk encryption / move to a managed DB).
* End-customer accounts (storefront buyers, students, booking customers) do not exist; public flows are code+phone based.
* Sandbox billing must never be enabled in production (`PAYMENT_PROVIDER` unset ⇒ checkout returns 501).
* Live payment provider, SMS/WhatsApp/email providers and SSL automation are **unverified/absent** (boundaries only).
