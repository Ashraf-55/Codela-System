# Security review (static code review + automated tests)
Method: reading the code and running the project's test-suite. **No penetration test, no dependency audit (`npm audit` needs network), no browser testing was performed.** Treat this as a review, not a certification.

## Verified by automated tests (367+ tests)
Tenant isolation for every entity of every product; staff vs platform-admin separation; CSRF on mutating routes; session/cookie flags (`httpOnly`, `sameSite`, `secure` in production); bcrypt password hashing; rate limiting with trusted-proxy handling (spoofed `X-Forwarded-For` ignored); mass-assignment stripping; permission checks independent of the UI; payment webhooks are signed, idempotent and amount-checked; file uploads are validated by content (not name/MIME), size-limited, tenant-scoped, quota-limited, served with `nosniff` + sandbox CSP; portal sessions bound to one tenant; password-reset / verification tokens are signed, expiring, single-use (reset).

## Findings fixed during this work
| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | `trust proxy = true` allowed forged `X-Forwarded-For` → rate-limit bypass | High | hop/CIDR-based config, `true` rejected |
| 2 | Next proxy relayed the browser's `X-Forwarded-For` | High | derived from trusted hops only |
| 3 | Portal cookie names collided with platform-admin cookies (`psid`/`pcsrf`) | Medium | renamed `cust_sid`/`cust_csrf` |
| 4 | Web proxy dropped `content-disposition`/sandbox CSP/`cache-control` from file downloads | Medium | pass-back allow-list |
| 5 | Attachments could be read by users lacking permission on the parent record | Medium | attachment access = parent entity permission |
| 6 | No CSP/HSTS on the web app | Low | conservative CSP subset + HSTS in production |

## Known gaps / not done
- Dependency vulnerability scan; secret scanning; DAST.
- Staff and platform admins now have lock-out (5 failures → 15 min) and optional TOTP 2FA (Settings → Two-factor / Admin → Security; manual key entry, no QR code, no recovery codes — losing the device means an admin must reset it in the database). Customer accounts have lock-out only.
- Portal accounts are linked to records by e-mail: safe only with e-mail verification enabled.
- Strict nonce-based script CSP exists but is OPT-IN (`CSP_STRICT=1`) because it was not tested in a browser; the default CSP does not restrict scripts/styles.
- SQLite single-node: no horizontal scaling; uploads on local disk.
- Paymob/Resend/Twilio/WhatsApp integrations are untested against the live services.


## Addendum 2026-11-24 — completion pass
| Area | Finding | Fix / evidence | Residual risk |
|---|---|---|---|
| RBAC | Approval decisions (payment requests, progress claims) only needed `update` | New `approve` action: `EntityDef.approvals` makes moving status to approved/rejected require `<module>.approve`; tested (`governance.test.ts`) | Other approval-like transitions (e.g. quotations) still use `update` |
| RBAC | No way to give staff a custom permission set | `/tenant/roles` custom roles: grantable permissions are whitelisted per product; `*`, wildcards, `roles.manage`, `employees.manage`, `subscription.manage`, `tenant.settings` can never be granted; reserved names; owner-only; audited | Owner decides what custom roles can do inside a module |
| Data export | None existed | `<module>.export` + tenant-scoped query + 20 000 row cap + audit `record.export` + CSV formula-injection neutralisation (`= + - @ TAB CR`) | Exported files are outside our control |
| Uploads | Site images | New `site` purpose: images only (magic-byte detection), 5 MB, `tenant.settings`; public by random UUID | Public images cannot be un-cached from CDNs |
| XSS | Owner-edited website text, announcements, templates | All rendered as text; URLs restricted to https / uploaded files; template variables whitelisted and control chars stripped | – |
| Subscription enforcement | Add-ons never expired | Monthly lifecycle job; expired add-ons drop out of entitlements on the backend; renewal only by manual payment (never charged silently) | Job is in-process (hourly); run one instance or add a lock when scaling out |
| Privilege | Staff role change | `PUT /tenant/employees/:id/role` (owner only; owner/driver/self excluded) | – |
| Patient data | Lab / imaging results in the portal | Portal whitelists fields and hides results until `resulted` / `reported` (draft never shown); own records only | – |
| Platform | Manual activate/renew/cancel | Reason required (3–300), state machine, `plans.manage`, audit + subscription history | Operator can grant access without a receipt by design |
Not re-audited this pass: CSRF/rate-limit/session code paths were untouched; dependency audit (`npm audit`) not run (no registry audit access).

---
## Addendum — sixth pass (final review of the new functionality)
Method: code review of every new route / screen, plus the automated tests named below. This is **not** a penetration test and no external scanner was run.

| Area | New surface | Result | Evidence |
|---|---|---|---|
| Authentication / session / CSRF | `POST /tenant/files/video` (streamed upload) | Requires a session (401 without), a CSRF token (403 without) and the `lessons.update` permission | `lesson-media.test.ts` |
| Tenant isolation | video upload, lesson file route, lead reports, quotations, map data | A lesson of another tenant cannot receive a file (404); files can be attached only to a lesson that belongs to the same tenant and was uploaded for that lesson (400 otherwise); other tenants see 0 quotations / leads | `lesson-media.test.ts`, `lead-and-visit-verification.test.ts`, `quotations.spec.ts` |
| File-upload security | hosted video | Type decided from the first bytes (MP4 `ftyp` / WebM EBML), not from the name or `Content-Type`; PNG / HTML renamed `.mp4` → 415 and nothing stays on disk; hard 150 MB cap checked on the declared length and again while streaming; storage-plan limit enforced; random storage key; private visibility; stored outside the web root | `lesson-media.test.ts` |
| Authorization of media | student stream / download | Only the enrolled, paid, unexpired student (or a free-preview lesson); an unpaid student gets 409, another student 404, anonymous 401; documents are always `attachment` | `lesson-media.test.ts`, `lesson-media.spec.ts` |
| Range handling | `Range` on videos | Single byte ranges only; invalid → 416 with an empty body (a bug that hung the connection was found and fixed) | `lesson-media.test.ts` |
| Input validation | page slugs, property coordinates, quotation lines | Slug: lowercase `a-z0-9-`, 2–60 chars, unique per site, reserved names refused (API + UI); coordinates: both-or-none, decimal degrees within range; quotation totals / transitions computed and enforced on the server | `site-builder.spec.ts`, `estate-map.spec.ts`, `quotations.spec.ts` |
| XSS | map popups, extra pages, quotation print view | Popups are built with DOM `textContent` (owner text is never parsed as HTML); extra pages render through the same escaped section components as the main page; React escapes quotation fields | code review only for popups; no dedicated XSS payload test was added for them |
| Payment security / refunds | unchanged in this pass | Refund and Fleet payment rules were delivered in the previous pass and their API tests still pass (`customer-payments`, `booking`) | vitest suite |
| Audit logging | video uploads | `file.uploaded` audit row written | code review |
| Sensitive data | proxy | The Next.js API proxy now forwards `Range` and returns `Content-Range` / `Accept-Ranges` / `Content-Length`; it still forwards no other client headers (no spoofable `X-Forwarded-For`) | code review |

Known limits: the web proxy buffers an uploaded video in memory (≤ 150 MB) before forwarding it — acceptable for owner uploads, not for many concurrent ones (put the API behind the reverse proxy directly for large deployments). The test-only `E2E_RELAX_RATE_LIMITS` switch is ignored when `NODE_ENV=production`.
