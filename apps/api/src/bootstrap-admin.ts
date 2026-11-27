import { count } from 'drizzle-orm';
import { platformStaff, type Db } from '@codela/db';
import { createPlatformStaff } from './platform-admin';

/**
 * First start on hosts without a terminal (e.g. Hostinger Web Apps): when ADMIN_EMAIL + ADMIN_PASSWORD are set and the
 * platform has NO staff yet, create the first super admin. Once any admin exists it never creates or changes anything,
 * so the variables can stay set (remove them after the first login anyway). Password rules are createPlatformStaff's.
 */
export async function bootstrapAdmin(db: Db, env: NodeJS.ProcessEnv): Promise<'skipped' | 'exists' | 'created'> {
  const email = env.ADMIN_EMAIL?.trim(); const password = env.ADMIN_PASSWORD;
  if (!email || !password) return 'skipped';
  if (db.select({ c: count() }).from(platformStaff).get()!.c > 0) return 'exists';
  await createPlatformStaff(db, { email, password, name: env.ADMIN_NAME?.trim() || 'Super Admin', role: 'super_admin', department: 'management' });
  return 'created';
}
