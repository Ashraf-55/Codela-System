import { notifications, type Db } from '@codela/db';
export function notifyTenant(db: Db, tenantId: string, type: string, title: string, body = '', userId: string | null = null) {
  db.insert(notifications).values({ tenantId, userId, type, title, body }).run();
}
