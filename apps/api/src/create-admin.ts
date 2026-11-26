import { ZodError } from 'zod';
import { createDb, seedPlatform } from '@codela/db';
import { createPlatformStaff } from './platform-admin';
import { databaseFile, loadEnv } from './env';

// Usage (PowerShell):  $env:ADMIN_EMAIL="you@codela.tech"; $env:ADMIN_PASSWORD="<strong password>"; npm run create-admin
// Usage (bash):        ADMIN_EMAIL=you@codela.tech ADMIN_PASSWORD='<strong password>' npm run create-admin
// Optional: ADMIN_NAME (default "Super Admin"). Passwords are bcrypt-hashed by createPlatformStaff; nothing is hardcoded or logged.
function fail(msg: string): never { console.error(`[create-admin] ${msg}`); process.exit(1); }

async function main() {
  loadEnv();
  const email = process.env.ADMIN_EMAIL?.trim(), password = process.env.ADMIN_PASSWORD;
  if (!email || !password) fail('Set the ADMIN_EMAIL and ADMIN_PASSWORD environment variables (no credentials are hardcoded).');
  const db = createDb(databaseFile());
  seedPlatform(db);
  try {
    const s = await createPlatformStaff(db, { email, password, name: process.env.ADMIN_NAME?.trim() || 'Super Admin', role: 'super_admin', department: 'management' });
    console.log(`Created super admin ${s.email}`);
  } catch (e) {
    if (e instanceof ZodError) fail(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
    if (/UNIQUE constraint failed/.test(String((e as Error)?.message))) fail(`An account with the email ${email.toLowerCase()} already exists; nothing was changed.`);
    fail(String((e as Error)?.message ?? e));
  }
}
main();
