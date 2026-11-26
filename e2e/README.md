# End-to-end tests (Playwright)
Separate from the root workspace on purpose (the root `npm ci` is unaffected).
```
# terminal 1 / 2 (from the repo root)
npm run dev:api
npm run dev:web
# terminal 3
cd e2e
npm install
npx playwright install chromium
npm test
```
Env: `E2E_BASE_URL` (default http://localhost:3000). Each test registers its own throw-away business, so a dev database accumulates `e2e…` tenants; delete them or use a scratch `DATABASE_FILE`.
These specs were written without being able to run them in the authoring environment; treat the first run as a calibration pass.
