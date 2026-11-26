import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/migrations/**', 'docs/qa/evidence/**', 'apps/web/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',            // hooks/handlers use loosely typed JSON records by design (documented)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': ['warn', { allow: ['error', 'log'] }],
    },
  },
  { files: ['apps/web/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks }, rules: { ...reactHooks.configs.recommended.rules } },
);
