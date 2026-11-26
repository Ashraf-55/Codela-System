# SUBSCRIPTION_SYSTEM

**Plans** (per product, editable by finance/super admin): Starter, Professional, Business — monthly + annual prices (integer minor units), trial days, limits JSON (`maxEmployees`, `maxBranches`, `maxRecords`, `storageMb`, `customDomain`, `advancedReports`). Defaults are seeded from `packages/db/src/seed.ts` and are never overwritten by re-seeding.

**State machine** (`packages/shared/src/subscription.ts`, unit-tested): `trialing → active | expired`, `active → past_due (grace 7 days) → suspended`, `active → canceled` (at period end or immediately), payment success re-activates. Access: `trialing`/`active`/`past_due` = full; `suspended`/`expired`/`canceled` = **read-only** (writes return `402 SUBSCRIPTION_INACTIVE`; data is kept; `/tenant/subscription*` and notifications remain writable so the tenant can pay).

**Add-ons** (marketplace per product compatibility): grants add numeric limits or boolean features (`customDomain`, `premiumTemplates`, `sms`, `whatsapp`, `aiAssistant`…). Activation/cancellation currently records the entitlement only — **add-on charging is not wired to the gateway yet**.

**Billing records & gateway**: `POST /tenant/subscription/checkout` creates a `billing_invoices` row + a pending `payment_transactions` row through the `PaymentGateway` boundary (idempotent via `Idempotency-Key`). Results arrive via signed, idempotent webhooks (`POST /api/v1/webhooks/:provider`) or, in sandbox, `…/sandbox-confirm`. Success activates/renews the subscription exactly once; failure moves an active subscription to `past_due`.
* `sandbox` provider: **no money moves**; every record is flagged `simulated`; analytics keep real vs simulated collections separate.
* `paymob`: configuration check only. Live API calls and webhook HMAC verification are **not implemented/verified** → returns `501 PAYMENT_NOT_CONFIGURED`. Needs a Paymob account, API key, integration ids and HMAC secret.
* In production (`NODE_ENV=production`) no provider is active unless `PAYMENT_PROVIDER` is set, so checkout fails honestly instead of faking payments.

**Revenue analytics** (`GET /platform/analytics`): MRR/ARR computed with integer math from active subscriptions (annual → price/12 rounded), per currency/product/plan, plus `collected` (real vs simulated), failed payments and outstanding invoices. `simulated: true` whenever sandbox activity exists.
