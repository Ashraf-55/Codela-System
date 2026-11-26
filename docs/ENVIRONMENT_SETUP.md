# Environment setup

Requirements: Node.js >= 22, npm >= 10 (see README for the PowerShell steps). All variables are documented, with comments, in `.env.example`; never commit real values.

1. `npm ci`
2. `copy .env.example .env`, then set at least `CSRF_SECRET` (32+ random characters in production).
3. Create the first Super Admin: set `ADMIN_EMAIL` and `ADMIN_PASSWORD`, run `npm run create-admin`, then remove them from the environment.
4. `npm run dev:api` (creates `data/codela.db` and applies migrations), `npm run dev:web`.
5. Checks: `npm run check` (lint, typecheck, tests, build).

Production essentials: `NODE_ENV=production`, leave `PAYMENT_PROVIDER` empty (manual InstaPay / Vodafone Cash; `sandbox` grants add-ons and upgrades for free), set `ROOT_DOMAIN`, `TRUST_PROXY`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, back up `data/` and `UPLOAD_DIR`. Email, SMS and WhatsApp stay "no_provider" until their credentials are set. See `docs/DEPLOYMENT.md` and `docs/PRODUCTION.md`.
