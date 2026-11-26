/** Industry-specific work boards (one per product): the live operational screen for that business, driven by real records.
 *  `next` lists the statuses a card can move to from each column; the API still enforces the real transition rules and payment/dispatch guards. */
export interface BoardCfg {
  entity: string; statusField?: string; /* default 'status' */ title: { ar: string; en: string }; today?: boolean; /* only records dated today */
  columns: { status: string; next: string[]; /** show only records whose field equals value (e.g. delivered orders still unpaid) */ only?: { field: string; value: string }; hint?: { ar: string; en: string } }[];
  refs: [field: string, entity: string][]; timeField?: string; extra?: string[];
  /** a one-click "record payment" action on cards that are still unpaid (the API still enforces unpaid -> paid only) */
  payable?: { field: string; from: string; to: string; record?: { entity: string; amountField: string; methodRefField?: string } };
  /** statuses whose cards get carrier / tracking-number inputs when moved to `to` (sent with the same PATCH) */
  shipping?: { from: string; to: string };
}
export const BOARDS: Record<string, BoardCfg> = {
  medical: { entity: 'appointment', title: { ar: 'مواعيد اليوم وغرفة الانتظار', en: "Today's appointments & waiting room" }, today: true, timeField: 'startTime',
    refs: [['patientId', 'patient'], ['doctorId', 'doctor']],
    columns: [{ status: 'scheduled', next: ['confirmed', 'cancelled', 'no_show'] }, { status: 'confirmed', next: ['completed', 'no_show', 'cancelled'] }, { status: 'completed', next: [] }] },
  booking: { entity: 'appointment', title: { ar: 'حجوزات اليوم', en: "Today's bookings" }, today: true, timeField: 'startTime',
    refs: [['customerId', 'customer'], ['serviceId', 'service'], ['staffId', 'staff']],
    columns: [{ status: 'pending', next: ['confirmed', 'cancelled', 'no_show'] }, { status: 'confirmed', next: ['completed', 'no_show', 'cancelled'] }, { status: 'completed', next: [] }] },
  restaurant: { entity: 'order', title: { ar: 'شاشة المطبخ', en: 'Kitchen display' }, refs: [], extra: ['type', 'total'],
    columns: [{ status: 'new', next: ['preparing', 'cancelled'] }, { status: 'preparing', next: ['ready', 'cancelled'] }, { status: 'ready', next: ['served', 'out_for_delivery'] }] },
  ecommerce: { entity: 'order', title: { ar: 'مسار الطلبات', en: 'Order pipeline' }, refs: [['customerId', 'customer']], extra: ['total', 'paymentStatus', 'carrier', 'trackingNumber'],
    payable: { field: 'paymentStatus', from: 'unpaid', to: 'paid', record: { entity: 'payment', amountField: 'total', methodRefField: 'paymentMethodId' } }, shipping: { from: 'processing', to: 'shipped' },
    // returns are handled through return requests (API rule), so a shipped order can only move to delivered here
    columns: [{ status: 'pending', next: ['confirmed', 'cancelled'] }, { status: 'confirmed', next: ['processing', 'cancelled'] }, { status: 'processing', next: ['cancelled'] }, { status: 'shipped', next: ['delivered'] },
      { status: 'delivered', next: [], only: { field: 'paymentStatus', value: 'unpaid' }, hint: { ar: 'تم التسليم ولم يُحصَّل — سجّل الدفع', en: 'Delivered but unpaid — record the payment' } }] },
  fleet: { entity: 'shipment', title: { ar: 'لوحة الشحنات', en: 'Shipment board' }, refs: [], extra: ['cod'],
    columns: [{ status: 'created', next: ['picked_up', 'cancelled'] }, { status: 'picked_up', next: ['at_hub'] }, { status: 'at_hub', next: ['out_for_delivery'] }, { status: 'out_for_delivery', next: ['delivered', 'failed_attempt'] }] },
  automotive: { entity: 'workOrder', title: { ar: 'لوحة الورشة', en: 'Workshop board' }, refs: [['vehicleId', 'vehicle']], extra: ['total'],
    columns: [{ status: 'open', next: ['diagnosing', 'cancelled'] }, { status: 'diagnosing', next: ['awaiting_parts', 'in_progress'] }, { status: 'awaiting_parts', next: ['in_progress'] }, { status: 'in_progress', next: ['ready'] }, { status: 'ready', next: ['delivered'] }] },
  'automotive:requests': { entity: 'bookingRequest', title: { ar: 'طلبات الحجز وعروض الأسعار', en: 'Booking & quote requests' }, refs: [['serviceId', 'service'], ['partId', 'sparePart']], extra: ['kind', 'plate', 'phone', 'preferredDate'],
    columns: [{ status: 'new', next: ['converted', 'rejected'] }, { status: 'converted', next: [] }, { status: 'rejected', next: [] }] },
  'business:quotations': { entity: 'quotation', title: { ar: 'عروض الأسعار', en: 'Quotations' }, refs: [['customerId', 'customer']], extra: ['total', 'validUntil'],
    columns: [{ status: 'draft', next: ['sent', 'rejected'] }, { status: 'sent', next: ['accepted', 'rejected', 'expired'] }, { status: 'accepted', next: [] }, { status: 'rejected', next: [] }] },
  'business:applications': { entity: 'jobApplication', title: { ar: 'طلبات التوظيف', en: 'Job applications' }, refs: [['jobId', 'job']], extra: ['email', 'phone', 'cvUrl'],
    columns: [{ status: 'new', next: ['reviewed', 'rejected'] }, { status: 'reviewed', next: ['shortlisted', 'rejected'] }, { status: 'shortlisted', next: ['rejected'] }, { status: 'rejected', next: [] }] },
  'learning:reviews': { entity: 'review', title: { ar: 'مراجعة التقييمات', en: 'Review moderation' }, refs: [['courseId', 'course']], extra: ['rating', 'authorName', 'comment'],
    columns: [{ status: 'pending', next: ['approved', 'hidden'] }, { status: 'approved', next: ['hidden'] }, { status: 'hidden', next: ['approved'] }] },
  learning: { entity: 'liveSession', title: { ar: 'الحصص المباشرة', en: 'Live sessions' }, refs: [['courseId', 'course']], extra: ['title', 'startsAt'],
    columns: [{ status: 'scheduled', next: ['live', 'cancelled'] }, { status: 'live', next: ['ended'] }, { status: 'ended', next: [] }] },
  realestate: { entity: 'saleDeal', title: { ar: 'مسار الصفقات', en: 'Deals pipeline' }, refs: [['propertyId', 'property'], ['clientId', 'client'], ['brokerId', 'broker']],
    columns: [{ status: 'reserved', next: ['contracted', 'cancelled'] }, { status: 'contracted', next: ['completed', 'cancelled'] }, { status: 'completed', next: [] }] },
  'realestate:leads': { entity: 'lead', statusField: 'stage', title: { ar: 'مسار العملاء المحتملين', en: 'Leads pipeline' }, refs: [['brokerId', 'broker'], ['propertyId', 'property']], extra: ['budget', 'source'],
    columns: [{ status: 'new', next: ['contacted', 'viewing', 'lost'] }, { status: 'contacted', next: ['viewing', 'negotiation', 'lost'] }, { status: 'viewing', next: ['negotiation', 'lost'] }, { status: 'negotiation', next: ['won', 'lost'] }] },
  'realestate:viewings': { entity: 'viewing', title: { ar: 'المعاينات', en: 'Viewings' }, refs: [['propertyId', 'property'], ['brokerId', 'broker']], extra: ['date', 'startTime', 'visitorName'],
    columns: [{ status: 'requested', next: ['scheduled', 'cancelled'] }, { status: 'scheduled', next: ['done', 'no_show', 'cancelled'] }] },
  construction: { entity: 'task', title: { ar: 'لوحة مهام المشاريع', en: 'Project tasks' }, refs: [['projectId', 'project'], ['assigneeId', 'worker']],
    columns: [{ status: 'todo', next: ['doing', 'cancelled'] }, { status: 'doing', next: ['done', 'cancelled'] }, { status: 'done', next: [] }] },
  business: { entity: 'deal', statusField: 'stage', title: { ar: 'مسار الصفقات', en: 'Sales pipeline' }, refs: [['customerId', 'customer']], extra: ['title', 'value'],
    columns: [{ status: 'prospecting', next: ['qualified', 'lost'] }, { status: 'qualified', next: ['proposal', 'lost'] }, { status: 'proposal', next: ['negotiation', 'lost'] }, { status: 'negotiation', next: ['won', 'lost'] }, { status: 'won', next: [] }] },
};
