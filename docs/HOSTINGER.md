# Deploying on Hostinger (Business / Cloud "Web Apps")

One web app runs everything: `npm start` (`scripts/start-all.mjs`) starts the API privately on 127.0.0.1:4000 and the website on the port Hostinger gives (`PORT`).

| Setting | Value |
|---|---|
| Node.js | 22 or newer |
| Build command | `npm run build` (install: `npm ci`) |
| Start command | `npm start` |
| Domain | e.g. `saas.codela.tech` |

## Environment variables (hPanel)
| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CSRF_SECRET` | 64 random characters (never share) |
| `ROOT_DOMAIN` | `saas.codela.tech` |
| `PAYMENT_PROVIDER` | `sandbox` while testing (manual InstaPay / Vodafone Cash works without it) |
| `DATABASE_FILE` | `../codela-data/codela.db` — **outside** the app folder so redeploys keep the data |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first Super Admin, created on first start only when no admin exists; remove after logging in |

Later: `RESEND_API_KEY` (e-mail), `TWILIO_*` (SMS), `WHATSAPP_*` (WhatsApp) — see `.env.example`.

## Limits on this kind of hosting
* Customer sites open at `https://saas.codela.tech/sites/<business-slug>` (subdomains per customer need wildcard DNS + TLS → VPS).
* SQLite lives in one file: back up `codela-data/` regularly (`npm run backup` on a VPS).
* If the host cannot run the monorepo build or keep two processes, use a Hostinger VPS with `docker compose up -d` (`docker-compose.yml`, `deploy/`).
