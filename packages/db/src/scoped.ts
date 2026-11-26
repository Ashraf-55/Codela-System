import { and, eq } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from './client';
import { customers } from './schema';

interface TenantTable extends SQLiteTable { id: SQLiteColumn; tenantId: SQLiteColumn }

/**
 * Generic repository bound to ONE tenant. tenantId is injected into every
 * read/write predicate and forced on insert, so callers cannot cross tenants.
 */
function repo<T extends TenantTable>(db: Db, table: T, tenantId: string) {
  type Row = T['$inferSelect'];
  return {
    list(): Row[] {
      return db.select().from(table as SQLiteTable).where(eq(table.tenantId, tenantId)).all() as Row[];
    },
    get(id: string): Row | undefined {
      return db.select().from(table as SQLiteTable)
        .where(and(eq(table.id, id), eq(table.tenantId, tenantId))).get() as Row | undefined;
    },
    insert(values: Omit<T['$inferInsert'], 'tenantId' | 'id'>): Row {
      return db.insert(table).values({ ...values, tenantId } as never).returning().get() as Row;
    },
    update(id: string, values: Partial<Omit<T['$inferInsert'], 'tenantId' | 'id'>>): number {
      const { tenantId: _t, id: _i, ...safe } = values as Record<string, unknown>;
      return db.update(table).set(safe as never)
        .where(and(eq(table.id, id), eq(table.tenantId, tenantId))).run().changes;
    },
    remove(id: string): number {
      return db.delete(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId))).run().changes;
    },
  };
}

export function scoped(db: Db, tenantId: string) {
  if (!tenantId) throw new Error('tenantId is required');
  return { tenantId, customers: repo(db, customers as unknown as TenantTable & typeof customers, tenantId) };
}
export type ScopedDb = ReturnType<typeof scoped>;
export { repo as tenantRepo };
