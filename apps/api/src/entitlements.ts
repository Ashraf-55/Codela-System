import { and, count, eq, inArray } from 'drizzle-orm';
import { addOns, customers, records, memberships, plans, subscriptionEvents, subscriptions, tenantAddOns, tenants, type Db } from '@codela/db';
import { accessLevel, tick, type Sub, type SubStatus } from '@codela/shared';
import { HttpError } from './errors';

export const GRACE_DAYS = 7;
export type Limits = Record<string, number | boolean>;

export function toSub(r: typeof subscriptions.$inferSelect): Sub {
  return { status: r.status as SubStatus, billingPeriod: r.billingPeriod as Sub['billingPeriod'], trialEndsAt: r.trialEndsAt,
    currentPeriodStart: r.currentPeriodStart, currentPeriodEnd: r.currentPeriodEnd, graceEndsAt: r.graceEndsAt,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd, canceledAt: r.canceledAt };
}
export function saveSub(db: Db, subId: string, tenantId: string, s: Sub, eventType: string, from: string | null, meta?: Record<string, unknown>) {
  db.update(subscriptions).set({ status: s.status, billingPeriod: s.billingPeriod, trialEndsAt: s.trialEndsAt,
    currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd, graceEndsAt: s.graceEndsAt,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd, canceledAt: s.canceledAt }).where(eq(subscriptions.id, subId)).run();
  db.insert(subscriptionEvents).values({ tenantId, subscriptionId: subId, type: eventType, fromStatus: from, toStatus: s.status, meta }).run();
}

/** Loads the tenant subscription, applying (and persisting) any time-based transition first. */
export function loadSubscription(db: Db, tenantId: string, now = new Date()) {
  const row = db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).get();
  if (!row) throw new HttpError(402, 'SUBSCRIPTION_INACTIVE', 'No subscription for this business');
  const before = toSub(row);
  const after = tick(before, now, GRACE_DAYS);
  if (after.status !== before.status) saveSub(db, row.id, tenantId, after, `auto_${after.status}`, before.status);
  const plan = db.select().from(plans).where(eq(plans.id, row.planId)).get()!;
  return { id: row.id, sub: after, plan };
}

export function effectiveLimits(db: Db, tenantId: string, planLimits: Limits): Limits {
  const out: Limits = { ...planLimits };
  const rows = db.select({ grants: addOns.grants }).from(tenantAddOns).innerJoin(addOns, eq(addOns.key, tenantAddOns.addOnKey))
    .where(and(eq(tenantAddOns.tenantId, tenantId), inArray(tenantAddOns.status, ['active', 'renewal_due']))).all();
  for (const { grants } of rows) for (const [k, v] of Object.entries(grants)) {
    out[k] = typeof v === 'number' ? ((out[k] as number) ?? 0) + v : (out[k] === true || v);
  }
  return out;
}

export function usage(db: Db, tenantId: string) {
  const employees = db.select({ c: count() }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, 'active'))).get()!.c;
  const customersCount = db.select({ c: count() }).from(customers).where(eq(customers.tenantId, tenantId)).get()!.c;
  const recs = db.select({ c: count() }).from(records).where(eq(records.tenantId, tenantId)).get()!.c;
  return { maxEmployees: employees, maxRecords: customersCount + recs, maxBranches: 0 } as Record<string, number>;
}

export function getEntitlements(db: Db, tenantId: string, now = new Date()) {
  const { id, sub, plan } = loadSubscription(db, tenantId, now);
  const limits = effectiveLimits(db, tenantId, plan.limits);
  return { subscriptionId: id, sub, plan, limits, access: accessLevel(sub.status), usage: usage(db, tenantId) };
}

export function assertWritable(db: Db, tenantId: string) {
  const e = getEntitlements(db, tenantId);
  if (e.access !== 'full') throw new HttpError(402, 'SUBSCRIPTION_INACTIVE', 'Subscription is not active; your data is safe and read-only until you renew');
}
export function assertWithinLimit(db: Db, tenantId: string, key: 'maxEmployees' | 'maxRecords' | 'maxBranches', adding = 1) {
  const e = getEntitlements(db, tenantId);
  const limit = e.limits[key];
  if (typeof limit === 'number' && e.usage[key] + adding > limit)
    throw new HttpError(403, 'PLAN_LIMIT_EXCEEDED', `Plan limit reached for ${key} (${limit}). Upgrade your plan or add an add-on.`);
}
export const tenantProduct = (db: Db, tenantId: string) => db.select({ p: tenants.productSlug }).from(tenants).where(eq(tenants.id, tenantId)).get()?.p;
