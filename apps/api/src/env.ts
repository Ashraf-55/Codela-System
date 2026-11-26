import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Loads <repo>/.env (does not override variables already set in the environment). */
export function loadEnv() { const f = path.join(REPO_ROOT, '.env'); if (existsSync(f)) process.loadEnvFile(f); }
export function databaseFile(): string {
  const f = process.env.DATABASE_FILE ?? path.join(REPO_ROOT, 'data', 'codela.db');
  const abs = path.isAbsolute(f) ? f : path.resolve(REPO_ROOT, f); mkdirSync(path.dirname(abs), { recursive: true }); return abs;
}
