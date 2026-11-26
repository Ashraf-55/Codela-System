import type { Locale } from './i18n';
type L = { ar: string; en: string };
export interface ProductContent { tagline: L; audience: L; problems: L; features: L[]; faq: { q: L; a: L }[] }
const f = (ar: string, en: string): L => ({ ar, en });
const faq = (): { q: L; a: L }[] => [
  { q: f('هل توجد فترة تجربة؟', 'Is there a free trial?'), a: f('نعم، تجربة مجانية على باقة المبتدئ دون إدخال بطاقة.', 'Yes — a free trial on the Starter plan, no card required.') },
  { q: f('ماذا يحدث لبياناتي إذا انتهى الاشتراك؟', 'What happens to my data if my subscription ends?'), a: f('لا نحذف بياناتك أبدًا؛ يتحول الحساب للقراءة فقط حتى تجدد.', 'We never delete your data; the account becomes read-only until you renew.') },
  { q: f('هل أستطيع ربط دومين خاص بي؟', 'Can I use my own domain?'), a: f('نعم، متاح في الباقات الأعلى أو كإضافة، مع تحقق من ملكية الدومين.', 'Yes — on higher plans or as an add-on, with DNS ownership verification.') },
];
export const CONTENT: Record<string, ProductContent> = {
  medical: { tagline: f('إدارة العيادة والموقع في مكان واحد', 'Run your clinic and its website in one place'), audience: f('العيادات والمراكز الطبية والمعامل والصيدليات', 'Clinics, medical centres, labs and pharmacies'),
    problems: f('مواعيد متضاربة وملفات ورقية وفواتير غير منظمة.', 'Double bookings, paper files and untidy billing.'),
    features: [f('ملفات المرضى والسجل الطبي بصلاحيات صارمة', 'Patient files and medical records with strict access'), f('حجز مواعيد بمنع التعارض وجداول الأطباء', 'Appointments with conflict prevention and doctor schedules'), f('روشتات وطلبات تحاليل', 'Prescriptions and lab requests'), f('فواتير ومدفوعات بحسابات دقيقة', 'Invoices and payments with exact maths'), f('موقع للعيادة مع حجز واستفسارات', 'Clinic website with booking requests and inquiries'), f('تقارير وتحليلات تشغيلية', 'Operational reports and analytics')], faq: faq() },
  realestate: { tagline: f('من الإعلان إلى العمولة', 'From listing to commission'), audience: f('شركات التسويق العقاري والمطورون والسماسرة', 'Agencies, developers, brokers and property managers'),
    problems: f('عقارات مكررة وعملاء ضائعون وعمولات يدوية.', 'Duplicate listings, lost leads and manual commissions.'),
    features: [f('عقارات ومشروعات ووحدات بمعارض صور', 'Properties, projects and units with galleries'), f('خط مبيعات وعملاء محتملون', 'Sales pipeline and leads'), f('حجز العقار يمنع البيع المزدوج', 'Reservations prevent double selling'), f('عمولات وسطاء تُحسب تلقائيًا', 'Broker commissions calculated automatically'), f('عقود إيجار ومستندات', 'Rental contracts and documents'), f('بحث متقدم على الموقع', 'Advanced property search on your website')], faq: faq() },
  ecommerce: { tagline: f('متجرك الإلكتروني وإدارته', 'Your online store and its back office'), audience: f('المتاجر ومحلات التجزئة والبائعون أونلاين', 'Retail stores, online sellers and product businesses'),
    problems: f('مخزون غير دقيق وطلبات متأخرة ومرتجعات معقدة.', 'Inaccurate stock, late orders and messy returns.'),
    features: [f('منتجات وأنواع ومخزون بسجل حركات', 'Products, variants and ledger-based stock'), f('كوبونات وخصومات وشحن', 'Coupons, discounts and shipping rules'), f('حجز مخزون ذري عند الطلب', 'Atomic stock reservation at checkout'), f('مرتجعات واسترداد', 'Returns and refunds'), f('تتبع الطلب للعميل', 'Customer order tracking'), f('تقارير مبيعات', 'Sales reports')], faq: faq() },
  restaurant: { tagline: f('من الطاولة إلى المطبخ إلى الكاشير', 'From table to kitchen to cashier'), audience: f('المطاعم والكافيهات وأنشطة الأغذية', 'Restaurants, cafes and food businesses'),
    problems: f('طلبات ضائعة وتكلفة مواد غير مضبوطة.', 'Lost orders and uncontrolled ingredient costs.'),
    features: [f('منيو رقمي بإضافات', 'Digital menu with extras'), f('طلبات صالة وتيك أواي وديليفري', 'Dine-in, takeaway and delivery orders'), f('شاشة مطبخ وحالات الطلب', 'Kitchen workflow and order statuses'), f('خصم المكونات تلقائيًا من الوصفات', 'Automatic ingredient deduction from recipes'), f('ورديات كاشير وتسوية نقدية', 'Cashier shifts and cash reconciliation'), f('حجز طاولات', 'Table reservations')], faq: faq() },
  automotive: { tagline: f('ورشتك تحت السيطرة', 'Your workshop under control'), audience: f('مراكز الصيانة وورش السيارات ومحلات قطع الغيار', 'Service centres, workshops and spare-parts shops'),
    problems: f('تاريخ صيانة ضائع وقطع غير مسجلة.', 'Lost maintenance history and untracked parts.'),
    features: [f('عملاء ومركبات وتاريخ صيانة', 'Customers, vehicles and history'), f('أوامر شغل وتعيين فنيين', 'Work orders and technician assignment'), f('قطع غيار ومخزون', 'Spare parts and inventory'), f('فواتير ومدفوعات', 'Invoices and payments'), f('حجز صيانة من الموقع', 'Online maintenance booking'), f('تتبع حالة السيارة', 'Vehicle status tracking')], faq: faq() },
  learning: { tagline: f('أكاديميتك أونلاين', 'Your academy, online'), audience: f('الأكاديميات ومراكز التدريب والمدربون', 'Academies, training centres and instructors'),
    problems: f('تسجيلات يدوية وشهادات غير موثقة.', 'Manual enrolment and unverifiable certificates.'),
    features: [f('دورات ودروس وجلسات مباشرة', 'Courses, lessons and live sessions'), f('تسجيل ودفع وسعة', 'Enrolment, payments and capacity'), f('اختبارات بتصحيح دقيق', 'Exams with exact grading'), f('حضور وتقدم الطالب', 'Attendance and progress'), f('شهادات بكود تحقق عام', 'Certificates with public verification'), f('تحليلات التعلم', 'Learning analytics')], faq: faq() },
  construction: { tagline: f('كل مشروع بميزانيته وتكلفته الفعلية', 'Every project with its budget and real cost'), audience: f('شركات المقاولات والتشطيبات', 'Construction and finishing companies'),
    problems: f('تجاوز الميزانية دون إنذار.', 'Budget overruns without warning.'),
    features: [f('مشروعات ومراحل ومهام', 'Projects, milestones and tasks'), f('عروض أسعار تتحول لمشروع', 'Quotations that become projects'), f('ميزانيات ومصروفات وتنبيه التجاوز', 'Budgets, expenses and overrun flags'), f('مواد ومشتريات وموردون', 'Materials, purchasing and suppliers'), f('عمال وتكليفات وسجل عمل', 'Workers, assignments and work logs'), f('معرض أعمال ونموذج عرض سعر', 'Portfolio and quote requests')], faq: faq() },
  booking: { tagline: f('حجوزات بلا تعارض', 'Bookings without clashes'), audience: f('الصالونات ومراكز التجميل ومقدمو الخدمات', 'Salons, beauty centres and appointment businesses'),
    problems: f('مواعيد متداخلة وإلغاءات متأخرة.', 'Overlapping slots and late cancellations.'),
    features: [f('خدمات وفروع وموظفون بمهاراتهم', 'Services, branches and staff skills'), f('جداول عمل وإجازات', 'Working schedules and time off'), f('مواعيد متاحة لحظيًا على الموقع', 'Live availability on your website'), f('سياسة إلغاء ورسوم', 'Cancellation policy and fees'), f('مدفوعات وتقارير', 'Payments and reports'), f('إشعار عند كل حجز', 'Notification on every booking')], faq: faq() },
  fleet: { tagline: f('شحنات وسائقون وتحصيل تحت المراقبة', 'Shipments, drivers and cash collection under watch'), audience: f('شركات الشحن والتوصيل واللوجستيات', 'Delivery, shipping and logistics companies'),
    problems: f('شحنات ضائعة وتحصيل نقدي غير مسوّى.', 'Lost parcels and unsettled cash.'),
    features: [f('شحنات بكود تتبع وخط زمني', 'Shipments with tracking and timeline'), f('توجيه السائقين والسعة', 'Dispatch with driver and capacity checks'), f('تسعير تلقائي من التعرفة', 'Automatic pricing from rate cards'), f('تحصيل نقدي وتسوية', 'Cash collection and settlement'), f('مصروفات الأسطول', 'Fleet expenses'), f('بوابة تتبع عامة', 'Public tracking portal')], faq: faq() },
  business: { tagline: f('إدارة الأعمال بالكامل', 'Run the whole business'), audience: f('الشركات الصغيرة والمتوسطة والخدمية', 'Small and medium businesses and service companies'),
    problems: f('بيانات مبعثرة بين الجداول.', 'Data scattered across spreadsheets.'),
    features: [f('عملاء وصفقات وخط مبيعات مرجّح', 'CRM with weighted pipeline'), f('مخازن ومخزون وتحويلات', 'Warehouses, stock and transfers'), f('مشتريات وموردون', 'Purchasing and suppliers'), f('فواتير ومدفوعات ودفتر مالي', 'Invoices, payments and ledger'), f('مصروفات وتدفق نقدي', 'Expenses and cash flow'), f('موظفون ومهام', 'Employees and tasks')], faq: faq() },
};
export const pick = (l: L, locale: Locale) => l[locale];
export const PRODUCT_NAMES: Record<string, L> = {
  medical: f('نظام إدارة العيادات', 'Medical'), realestate: f('نظام إدارة العقارات', 'Real Estate'), ecommerce: f('نظام المتاجر الإلكترونية', 'E-Commerce'), restaurant: f('نظام المطاعم والكافيهات', 'Restaurant'),
  automotive: f('نظام مراكز الصيانة', 'Automotive'), learning: f('نظام التعليم والأكاديميات', 'Learning'), construction: f('نظام المقاولات والتشطيبات', 'Construction'), booking: f('نظام الحجوزات والمواعيد', 'Booking'),
  fleet: f('نظام الشحن والتوصيل', 'Fleet & Delivery'), business: f('نظام إدارة الأعمال', 'Business'),
};
