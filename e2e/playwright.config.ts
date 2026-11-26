import { defineConfig, devices } from '@playwright/test';

// Start the API and the web app first (npm run dev:api / npm run dev:web), then:  cd e2e && npm install && npx playwright install chromium && npm test
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1, // the browser tab occasionally crashes on small machines (1 CPU / 4 GB) during the long responsive journeys; a retry is reported as "flaky", never hidden
  workers: 1, // every journey creates its own business; keep runs serial and easy to read
  reporter: [['list'], ['html', { outputFolder: '../docs/qa/evidence/playwright-report', open: 'never' }], ['json', { outputFile: '../docs/qa/evidence/playwright-results.json' }]],
  outputDir: '../docs/qa/evidence/test-results', // screenshots, videos and traces land here
  use: { ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}), baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'on', video: process.env.E2E_NO_VIDEO ? 'off' : 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /(^|[\\/])responsive\.spec\.ts$/ }],
});
