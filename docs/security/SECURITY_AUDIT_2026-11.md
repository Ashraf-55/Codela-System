# Security audit: Codela (profile quick, PARTIAL coverage)
**Run status: incomplete.** Reason: no independent verifier agents were available (one agent did all phases), and the app could not be executed offline. Source ref: codela-complete.zip (sha256 ca7c813d...), no git. Execution: sandboxed, no network, pure-function harness only. No prior runs. No budget set.

## Posture
Mature codebase: consistent tenant scoping, CSRF, lock-out, TOTP, signed webhooks, safe uploads. One confirmed authorization flaw and three leads.

## Confirmed
| Severity | Title | Boundary | Observed |
|---|---|---|---|
| medium | Business manager gets owner-only employees.manage | tenant role model | guard returns true for manager |

Detail: FINDINGS-DETAIL.md. Fix: namespace product permissions (or rename the module) and test per product that manager lacks employees.manage. Caveat: harness-level evidence, not an HTTP run; verification was self-performed.

## Needs validation (no severity)
| Lead | Blocker |
|---|---|
| Reset link host from X-Forwarded-Host | API reachable directly? PUBLIC_WEB_URL set? |
| Free add-on activation (docs admit billing unwired) | offline integration run; operator intent |
| Plan upgrade without payment | intended billing semantics |
See NEEDS-VALIDATION.md.

## Hardening and positives
- Tenant 2FA routes are not under authenticate (likely 500, fail-closed; the test expects 200): run login-security.test.ts. Rejected as a vulnerability.
- Public track/cancel flows rely on sequential code plus phone; consider unguessable codes.
- Slugs have no reserved list (www, api, login).
- Set PUBLIC_WEB_URL and bind the API to 127.0.0.1 in production; TOTP secrets are stored in plaintext.
- Positives: HMAC timing-safe compares, idempotent webhooks, SAFE_KEY file paths, tenant-scoped queries, reset tokens bound to old hash.

## Fix package (fix/)
- business-module-rename.patch: module employees -> hr. After it, harness shows manager has no employees.* and employees.manage is false (agents/hunter-perm/artifacts/perm-ns-after-fix.json).
- migrate-business-manager-permission.sql: updates existing business tenants (back up first).
- manager-employees.test.ts: copy to apps/api/test/; expects 403 for manager create/suspend in all 10 products. It should fail before the patch (business) and pass after.

## Coverage (ledger)
All 11 units reviewed (9 covered, 2 with candidates). Validators pass. run-metadata.json keeps run_status incomplete only because no independent verifier agents exist in this environment; refutation passes were done by the same reviewer. Run your own checks: the manager test, login-security.test.ts, and the three needs-validation items.

## Owner's npm test run (after the fix)
414 of 420 passed; manager-employees.test.ts passed 10/10. Six failures, none caused by the manager fix:
- login-security 2FA (2): real defect, authenticate not mounted on /auth/2fa. Fixed (app.ts) + twofa-auth.test.ts added.
- status-notify fleet (1): outdated test stub (no ctx.now/find/create). Fixed in the test.
- backup (1): WAL/-shm sidecar files left next to backup copies (seen on Windows). Fixed: copy switched to journal_mode=DELETE and prune removes sidecars. Not run here.
- delivery Resend (2): test bug. It sent the signed body as a Buffer with a JSON content-type; superagent JSON-serialises Buffers, so the server saw different bytes than were signed (the passing WhatsApp test sends a string). Fixed by sending a string. sign/verify functions were verified correct in an offline harness. Second run: 420/422 passed before this last fix.

## Update: add-ons and plan upgrades (fixed)
- Add-on activation now returns 501 unless the sandbox gateway is active (no free add-ons in production).
- change-plan to a higher tier on a paid (non-trial) subscription returns 402 UPGRADE_REQUIRES_PAYMENT outside sandbox. Trial tier choice and downgrades are unchanged.
- New test: apps/api/test/billing-no-free-upgrades.test.ts (uses a non-sandbox gateway). Existing tests run in sandbox mode and are unaffected.
- Still open (configuration): set PUBLIC_WEB_URL in production and keep port 4000 closed.
