import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { databaseFile, loadEnv, REPO_ROOT } from './env';

/**
 * Consistent online backup of the SQLite database (safe while the API is running; uses SQLite's backup API, not a file copy).
 *   npm run backup                 -> data/backups/codela-YYYYMMDD-HHMMSS.db   (keeps the newest BACKUP_KEEP, default 14)
 * Uploaded files live in UPLOAD_DIR (default data/uploads): back that folder up with the same schedule (see docs/PRODUCTION.md).
 */
export function pruneBackups(dir: string, keep: number) {
  const files = readdirSync(dir).filter((f) => /^codela-\d{8}-\d{6}\.db$/.test(f)).sort().reverse();
  for (const f of files.slice(Math.max(1, keep))) for (const sfx of ['', '-wal', '-shm']) rmSync(path.join(dir, f + sfx), { force: true });
}
export async function backupDatabase(src: string, dir: string, keep = 14, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  const dest = path.join(dir, `codela-${stamp}.db`);
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try { await db.backup(dest); } finally { db.close(); }
  const copy = new Database(dest); try { copy.pragma('journal_mode = DELETE'); } finally { copy.close(); } // self-contained copy: no -wal/-shm sidecar files
  const check = new Database(dest, { readonly: true });
  try { const r = check.pragma('integrity_check', { simple: true }); if (r !== 'ok') { rmSync(dest, { force: true }); throw new Error(`Backup failed integrity check: ${String(r)}`); } } finally { check.close(); }
  pruneBackups(dir, keep);
  return dest;
}

// CLI entry (npm run backup)
if (process.argv[1] && /backup\.(ts|js)$/.test(process.argv[1])) {
  loadEnv(); const src = databaseFile();
  if (!existsSync(src)) { console.error(`[backup] database not found: ${src}`); process.exit(1); }
  const dir = process.env.BACKUP_DIR ? path.resolve(REPO_ROOT, process.env.BACKUP_DIR) : path.join(REPO_ROOT, 'data', 'backups');
  backupDatabase(src, dir, Number(process.env.BACKUP_KEEP ?? 14) || 14).then((f) => console.log(`[backup] wrote ${f}`)).catch((e) => { console.error('[backup] failed:', (e as Error).message); process.exit(1); });
}
