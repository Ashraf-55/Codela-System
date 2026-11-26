# SUBSCRIPTIONS AND BILLING

* **Plans** (Starter / Professional / Business) per product, seeded for the 10 products; prices, trial days and limits are editable by Super Admin (`/admin/plans`), integer minor units only.
* **Trial**: every new tenant starts a 14-day trial (dates stored server-side; a new account cannot reset another's trial because the trial belongs to the tenant row).
* **States**: trial, active, past_due, suspended, expired, canceled. When a subscription ends, writes are refused (`402`), reads continue, data is never deleted, the billing page stays reachable.
* **Limits** (employees, records, storage, features) are enforced on the backend (`PLAN_LIMIT_EXCEEDED`), including add-on effects; downgrades are refused when current usage exceeds the new plan.
* **Add-ons** (extra employees/storage, WhatsApp, SMS, custom domain, premium templates...) are configurable per product and per tenant.
* **Payments**: manual InstaPay / Vodafone Cash with receipt review — see `PAYMENT_WORKFLOW.md`. Plans and add-ons are bought through the same flow and applied only on approval. `PAYMENT_PROVIDER` must stay empty in production (sandbox grants free upgrades). Paymob is implemented behind a gateway boundary and answers 501 without credentials; no live gateway has been verified.
* **Revenue analytics** (MRR/ARR, counts) come from subscription and billing records and separate real from simulated collections.
