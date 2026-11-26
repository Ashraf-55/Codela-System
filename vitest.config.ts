import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { BCRYPT_COST: '4' }, include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'] } });
