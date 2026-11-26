import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { addOns, plans, products } from './schema';

export const PRODUCT_NAMES: Record<string, [string, string]> = {
  medical: ['نظام إدارة العيادات', 'Medical'],
  realestate: ['نظام إدارة العقارات', 'Real Estate'],
  ecommerce: ['نظام المتاجر الإلكترونية', 'E-Commerce'],
  restaurant: ['نظام المطاعم والكافيهات', 'Restaurant'],
  automotive: ['نظام مراكز الصيانة', 'Automotive'],
  learning: ['نظام التعليم والأكاديميات', 'Learning'],
  construction: ['نظام المقاولات والتشطيبات', 'Construction'],
  booking: ['نظام الحجوزات والمواعيد', 'Booking'],
  fleet: ['نظام الشحن والتوصيل', 'Fleet & Delivery'],
  business: ['نظام إدارة الأعمال', 'Business'],
};

// Defaults only — all values are editable from the Super Admin (Phase 5). Prices in EGP minor units.
export const DEFAULT_TIERS = {
  starter: { nameAr: 'المبتدئ', nameEn: 'Starter', monthly: 49900, annual: 499000,
    limits: { maxEmployees: 3, maxBranches: 1, maxRecords: 1000, storageMb: 500, customDomain: false, advancedReports: false } },
  professional: { nameAr: 'المحترف', nameEn: 'Professional', monthly: 129900, annual: 1299000,
    limits: { maxEmployees: 10, maxBranches: 3, maxRecords: 20000, storageMb: 5000, customDomain: true, advancedReports: true } },
  business: { nameAr: 'الأعمال', nameEn: 'Business', monthly: 299900, annual: 2999000,
    limits: { maxEmployees: 50, maxBranches: 20, maxRecords: 500000, storageMb: 50000, customDomain: true, advancedReports: true } },
} as const;

const ADD_ONS = [
  { key: 'extra_employees', nameAr: 'موظفون إضافيون (+5)', nameEn: 'Extra employees (+5)', price: 14900, type: 'recurring', compat: '*', grants: { maxEmployees: 5 } },
  { key: 'extra_branches', nameAr: 'فروع إضافية (+2)', nameEn: 'Extra branches (+2)', price: 19900, type: 'recurring', compat: '*', grants: { maxBranches: 2 } },
  { key: 'extra_storage', nameAr: 'مساحة تخزين إضافية (+5GB)', nameEn: 'Extra storage (+5GB)', price: 9900, type: 'recurring', compat: '*', grants: { storageMb: 5000 } },
  { key: 'advanced_reports', nameAr: 'تقارير متقدمة', nameEn: 'Advanced reports', price: 24900, type: 'recurring', compat: '*', grants: { advancedReports: true } },
  { key: 'custom_domain', nameAr: 'دومين مخصص', nameEn: 'Custom domain', price: 9900, type: 'recurring', compat: '*', grants: { customDomain: true } },
  { key: 'whatsapp_notifications', nameAr: 'إشعارات واتساب', nameEn: 'WhatsApp notifications', price: 29900, type: 'recurring', compat: '*', grants: { whatsapp: true } },
  { key: 'sms_notifications', nameAr: 'إشعارات SMS', nameEn: 'SMS notifications', price: 19900, type: 'recurring', compat: '*', grants: { sms: true } },
  { key: 'ai_assistant', nameAr: 'مساعد الأعمال بالذكاء الاصطناعي', nameEn: 'AI business assistant', price: 49900, type: 'recurring', compat: '*', grants: { aiAssistant: true } },
  { key: 'premium_templates', nameAr: 'قوالب موقع مميزة', nameEn: 'Premium website templates', price: 39900, type: 'one_time', compat: '*', grants: { premiumTemplates: true } },
  { key: 'kitchen_display_pro', nameAr: 'شاشة مطبخ متقدمة', nameEn: 'Kitchen display Pro', price: 19900, type: 'recurring', compat: ['restaurant'], grants: { kitchenDisplayPro: true } },
  { key: 'lab_integration', nameAr: 'ربط المعامل', nameEn: 'Lab integration', price: 24900, type: 'recurring', compat: ['medical'], grants: { labIntegration: true } },
] as const;

/** Idempotent: inserts missing products/plans/add-ons, never overwrites admin edits. */
export function seedPlatform(db: Db): void {
  db.transaction((tx) => {
    for (const [slug, [ar, en]] of Object.entries(PRODUCT_NAMES)) {
      tx.insert(products).values({ slug, nameAr: ar, nameEn: en }).onConflictDoNothing().run();
      for (const [tier, t] of Object.entries(DEFAULT_TIERS)) {
        tx.insert(plans).values({ productSlug: slug, tier, nameAr: t.nameAr, nameEn: t.nameEn, priceMonthly: t.monthly,
          priceAnnual: t.annual, limits: { ...t.limits } }).onConflictDoNothing().run();
      }
    }
    for (const a of ADD_ONS) {
      tx.insert(addOns).values({ key: a.key, nameAr: a.nameAr, nameEn: a.nameEn, priceMinor: a.price, billingType: a.type,
        compatibleProducts: (a.compat === '*' ? '*' : [...a.compat]) as string[] | '*', grants: { ...a.grants } }).onConflictDoNothing().run();
    }
  });
}
export { eq };
