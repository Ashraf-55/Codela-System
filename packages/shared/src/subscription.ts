export type SubStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'expired' | 'canceled';
export type BillingPeriod = 'monthly' | 'annual';

export interface Sub {
  status: SubStatus; billingPeriod: BillingPeriod; trialEndsAt: string | null;
  currentPeriodStart: string | null; currentPeriodEnd: string | null;
  graceEndsAt: string | null; cancelAtPeriodEnd: boolean; canceledAt: string | null;
}
export type SubEvent =
  | { type: 'payment_succeeded' } | { type: 'payment_failed' }
  | { type: 'cancel'; atPeriodEnd: boolean } | { type: 'suspend' };

const iso = (d: Date) => d.toISOString();
const DAY = 86_400_000;

/** Add a billing period in UTC, clamping the day to the target month's length. */
export function addPeriod(from: Date, period: BillingPeriod): Date {
  const months = period === 'annual' ? 12 : 1;
  const y = from.getUTCFullYear(), m = from.getUTCMonth() + months, day = from.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

export function startTrial(now: Date, trialDays: number, billingPeriod: BillingPeriod): Sub {
  return { status: 'trialing', billingPeriod, trialEndsAt: iso(new Date(now.getTime() + trialDays * DAY)),
    currentPeriodStart: null, currentPeriodEnd: null, graceEndsAt: null, cancelAtPeriodEnd: false, canceledAt: null };
}

/** Time-based transitions. Pure: returns a new Sub. */
export function tick(sub: Sub, now: Date, graceDays: number): Sub {
  const t = now.toISOString();
  if (sub.status === 'trialing' && sub.trialEndsAt && t >= sub.trialEndsAt) return { ...sub, status: 'expired' };
  if (sub.status === 'active' && sub.currentPeriodEnd && t >= sub.currentPeriodEnd) {
    if (sub.cancelAtPeriodEnd) return { ...sub, status: 'canceled', canceledAt: sub.currentPeriodEnd };
    return { ...sub, status: 'past_due', graceEndsAt: iso(new Date(new Date(sub.currentPeriodEnd).getTime() + graceDays * DAY)) };
  }
  if (sub.status === 'past_due' && sub.graceEndsAt && t >= sub.graceEndsAt) return { ...sub, status: 'suspended' };
  return sub;
}

export function applyEvent(sub: Sub, ev: SubEvent, now: Date, graceDays = 7): Sub {
  switch (ev.type) {
    case 'payment_succeeded': {
      const clear = { graceEndsAt: null, cancelAtPeriodEnd: false, canceledAt: null, trialEndsAt: null };
      if (sub.status === 'active' && sub.currentPeriodEnd && now.toISOString() < sub.currentPeriodEnd) {
        const start = new Date(sub.currentPeriodEnd);
        return { ...sub, ...clear, status: 'active', currentPeriodStart: iso(start), currentPeriodEnd: iso(addPeriod(start, sub.billingPeriod)) };
      }
      return { ...sub, ...clear, status: 'active', currentPeriodStart: iso(now), currentPeriodEnd: iso(addPeriod(now, sub.billingPeriod)) };
    }
    case 'payment_failed':
      if (sub.status !== 'active') throw new Error(`payment_failed not valid in ${sub.status}`);
      return { ...sub, status: 'past_due', graceEndsAt: iso(new Date(now.getTime() + graceDays * DAY)) };
    case 'cancel':
      if (!['trialing', 'active', 'past_due'].includes(sub.status)) throw new Error(`cannot cancel in ${sub.status}`);
      if (ev.atPeriodEnd && sub.status === 'active') return { ...sub, cancelAtPeriodEnd: true };
      return { ...sub, status: 'canceled', canceledAt: iso(now), cancelAtPeriodEnd: false };
    case 'suspend':
      if (sub.status === 'expired' || sub.status === 'canceled') throw new Error(`cannot suspend in ${sub.status}`);
      return { ...sub, status: 'suspended' };
  }
}

/** Business data is never deleted; lapsed accounts become read-only. */
export function accessLevel(status: SubStatus): 'full' | 'read_only' {
  return status === 'trialing' || status === 'active' || status === 'past_due' ? 'full' : 'read_only';
}
