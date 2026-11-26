import { and, eq } from 'drizzle-orm';
import { notificationTemplates, type Db } from '@codela/db';
import type { Message } from './outbox';

type P = Record<string, unknown>;
const bi = (ar: string, en: string) => `${en}\n\n${ar}`;
/** Bilingual transactional templates. Payload keys are documented per template; missing keys render as empty text, never "undefined". */
export const TEMPLATES: Record<string, (p: P) => Message> = {
  booking_created: (p) => ({ to: '', subject: `Booking ${p.code}`, body: `Hi ${p.name}, your booking ${p.code} on ${p.date} at ${p.time} was received. / تم استلام حجزك ${p.code} بتاريخ ${p.date} الساعة ${p.time}.` }),
  appointment_confirmed: (p) => ({ to: '', subject: `Appointment confirmed ${p.code ?? ''} / تأكيد الموعد`, body: bi(`مرحبًا ${s(p.name)}، تم تأكيد موعدك ${s(p.code)} بتاريخ ${s(p.date)} الساعة ${s(p.time)}${p.provider ? ` مع ${s(p.provider)}` : ''}.`, `Hi ${s(p.name)}, your appointment ${s(p.code)} is confirmed for ${s(p.date)} at ${s(p.time)}${p.provider ? ` with ${s(p.provider)}` : ''}.`) }),
  appointment_reminder: (p) => ({ to: '', subject: 'Appointment reminder / تذكير بالموعد', body: bi(`تذكير: لديك موعد ${s(p.code)} غدًا/قريبًا بتاريخ ${s(p.date)} الساعة ${s(p.time)}.`, `Reminder: you have appointment ${s(p.code)} on ${s(p.date)} at ${s(p.time)}.`) }),
  order_update: (p) => ({ to: '', subject: `Order ${s(p.code)} / طلب`, body: bi(`تم تحديث حالة طلبك ${s(p.code)} إلى: ${s(p.status)}.`, `Your order ${s(p.code)} is now: ${s(p.status)}.`) }),
  subscription_notice: (p) => ({ to: '', subject: 'Subscription / الاشتراك', body: bi(`${s(p.messageAr)}`, `${s(p.messageEn)}`) }),
  payment_confirmation: (p) => ({ to: '', subject: `Payment received ${s(p.invoice)} / تم استلام الدفع`, body: bi(`تم استلام دفعتك للفاتورة ${s(p.invoice)} بمبلغ ${s(p.amount)} ${s(p.currency)}. شكرًا لك.`, `We received your payment for invoice ${s(p.invoice)}: ${s(p.amount)} ${s(p.currency)}. Thank you.`) }),
  status_update: (p) => ({ to: '', subject: `Update ${s(p.code)} / تحديث`, body: bi(`تم تحديث حالة ${s(p.code)} إلى: ${s(p.status)}.`, `Status of ${s(p.code)} is now: ${s(p.status)}.`) }),
  verify_email: (p) => ({ to: '', subject: 'Verify your e-mail / تأكيد البريد', body: bi(`لتأكيد بريدك افتح الرابط (صالح 24 ساعة): ${s(p.link)}`, `Confirm your e-mail with this link (valid 24 hours): ${s(p.link)}`) }),
  password_reset: (p) => ({ to: '', subject: 'Reset your password / إعادة تعيين كلمة المرور', body: bi(`لإعادة تعيين كلمة المرور افتح الرابط (صالح ساعة واحدة): ${s(p.link)}\nإن لم تطلب ذلك فتجاهل الرسالة.`, `Reset your password with this link (valid 1 hour): ${s(p.link)}\nIgnore this message if you did not ask for it.`) }),
};
function s(v: unknown): string { return v === undefined || v === null ? '' : String(v); }

/** Variables each template may use in an owner/Super-Admin edited version, written {{name}}. Anything else is rejected at save time. */
export const TEMPLATE_VARS: Record<string, { vars: string[]; required?: string[] }> = {
  booking_created: { vars: ['name', 'code', 'date', 'time'] },
  appointment_confirmed: { vars: ['name', 'code', 'date', 'time', 'provider'] },
  appointment_reminder: { vars: ['code', 'date', 'time'] },
  order_update: { vars: ['code', 'status'] },
  subscription_notice: { vars: ['messageEn', 'messageAr'] },
  payment_confirmation: { vars: ['invoice', 'amount', 'currency'] },
  status_update: { vars: ['code', 'status'] },
  verify_email: { vars: ['link'], required: ['link'] },
  password_reset: { vars: ['link'], required: ['link'] },
};
export const TEMPLATE_SAMPLE: Record<string, string> = { name: 'Sara', code: 'BK-0042', date: '2027-01-15', time: '17:00', provider: 'Dr. Ahmed', status: 'ready', messageEn: 'Your add-on renews on 2027-02-01.', messageAr: 'تتجدد إضافتك في 2027-02-01.', invoice: 'INV-0007', amount: '149.00', currency: 'EGP', link: 'https://example.com/verify?token=sample' };
const VAR = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
/** {{vars}} found in a text. */
export const varsIn = (t: string) => [...t.matchAll(VAR)].map((m) => m[1]);
/** Fills {{vars}}; unknown or missing variables render as empty text and control characters are removed (no header / log injection). */
const stripControl = (t: string) => Array.from(t).filter((ch) => { const c = ch.charCodeAt(0); return c === 9 || c === 10 || c === 13 || c >= 32; }).join('');
export const fillTemplate = (t: string, vars: Record<string, unknown>, allowed: string[]) => t.replace(VAR, (_m, k: string) => (allowed.includes(k) ? stripControl(s(vars[k])) : ''));

/** The message to send: the Super Admin's edited wording when one is active for this template + channel, else the built-in template. */
export function renderTemplate(db: Db, key: string, channel: string, payload: P): Message | undefined {
  const base = TEMPLATES[key]; if (!base) return undefined;
  const o = db.select().from(notificationTemplates).where(and(eq(notificationTemplates.key, key), eq(notificationTemplates.channel, channel))).get();
  if (!o || !o.active) return base(payload);
  const allowed = TEMPLATE_VARS[key]?.vars ?? [];
  return { to: '', subject: [fillTemplate(o.subjectEn, payload, allowed), fillTemplate(o.subjectAr, payload, allowed)].filter(Boolean).join(' / '), body: `${fillTemplate(o.bodyEn, payload, allowed)}\n\n${fillTemplate(o.bodyAr, payload, allowed)}` };
}
