export interface TrackCfg { action: string; fields: string[]; label: { ar: string; en: string } }
export const TRACK: Record<string, TrackCfg> = {
  ecommerce: { action: 'track', fields: ['code', 'phone'], label: { ar: 'تتبع الطلب', en: 'Track your order' } }, restaurant: { action: 'track', fields: ['code', 'phone'], label: { ar: 'تتبع الطلب', en: 'Track your order' } },
  fleet: { action: 'track', fields: ['code', 'phone'], label: { ar: 'تتبع الشحنة', en: 'Track your shipment' } }, automotive: { action: 'track', fields: ['plate', 'phone'], label: { ar: 'حالة السيارة', en: 'Vehicle status' } },
  booking: { action: 'status', fields: ['code', 'phone'], label: { ar: 'حالة الحجز', en: 'Booking status' } }, learning: { action: 'verify', fields: ['code'], label: { ar: 'التحقق من شهادة', en: 'Verify a certificate' } },
};
export const hasTracker = (slug: string) => slug in TRACK;
