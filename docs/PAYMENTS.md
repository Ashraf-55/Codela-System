# Payments (Paymob)
**Status: implemented, NOT verified against Paymob.** The authoring environment had no network. Signature maths, request shaping, amount checks and idempotency are unit/integration-tested with a faked network layer (`apps/api/test/paymob.test.ts`, `src/providers/paymob.ts`). You must run one sandbox payment end to end before going live.
## Flow
1. `POST /api/v1/tenant/subscription/checkout {billingPeriod}` → server creates a pending invoice + transaction and returns `redirectUrl` (Paymob iframe). Nothing is activated.
2. Paymob calls `POST /api/v1/webhooks/paymob?hmac=…` (transaction *processed* callback). The server verifies HMAC-SHA512, de-duplicates by event id, checks amount + currency equal the stored transaction, then activates (or fails) the subscription. The browser redirect is never trusted.
3. Pending/voided callbacks are acknowledged and ignored; refunded callbacks mark transaction and invoice `refunded` (the subscription is NOT auto-cancelled — operator decision).
## Setup
Set `PAYMENT_PROVIDER=paymob`, `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_IFRAME_ID`, `PAYMOB_HMAC_SECRET`; in the Paymob dashboard set the transaction-processed callback to `https://<api-host>/api/v1/webhooks/paymob`. Use Paymob test credentials first.
## To verify with real credentials
Field names of the classic Accept API (auth → order → payment key → iframe) were written from the public documentation; confirm against your account, and check that amounts are piasters (EGP, 2 decimals). Refund API call exists in `PaymobClient.refund` but is not wired to any route yet. Monthly/yearly billing is manual-renewal (each period = a new checkout); no recurring tokenised charge is implemented.

## Renewal (important)
Subscriptions are **manual-renewal**: each period is a new checkout. The platform e-mails the owner 3 days before the end with a link to Billing. **Automatic card charging (saved-card tokens / recurring billing) is NOT implemented** — it needs Paymob's tokenisation product enabled on your account and flows I could not verify. Refunds are done in the Paymob dashboard; the refunded callback marks the transaction/invoice `refunded` automatically.
