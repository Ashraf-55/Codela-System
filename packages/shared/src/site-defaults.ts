/**
 * Default public-website copy for each Codela product: who we are, what we do, what we offer.
 * Used (1) to pre-fill a new tenant's website draft so the owner edits real text instead of an empty box and
 * (2) as a render-time fallback for sites whose owner never wrote their own text.
 * `{name}` is replaced by the business name. Nothing here is a claim about a specific business's prices or hours.
 */
export type SiteLocale = 'ar' | 'en';
interface L { ar: string; en: string }
interface Item { title: L; text: L }
interface Copy { heroTitle: L; hero: L; aboutTitle: L; about: L; why: L[]; servicesTitle: L; servicesIntro: L; services: Item[] }

const i = (ar: string, en: string): L => ({ ar, en });
const s = (tAr: string, tEn: string, xAr: string, xEn: string): Item => ({ title: i(tAr, tEn), text: i(xAr, xEn) });

export const SITE_COPY: Record<string, Copy> = {
  medical: {
    heroTitle: i('{name} — رعاية طبية تثق فيها', '{name} — healthcare you can trust'),
    hero: i('احجز موعدك أونلاين مع نخبة من الأطباء، وتابع حجزك بسهولة.', 'Book online with our doctors and manage your appointment with ease.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} مركز طبي يقدّم رعاية متكاملة للمرضى في بيئة نظيفة ومريحة. فريقنا من الأطباء والتمريض يهتم بتشخيص دقيق وخطة علاج واضحة، مع احترام كامل لخصوصية بياناتك الطبية.', '{name} is a medical centre providing complete patient care in a clean, comfortable setting. Our doctors and nurses focus on accurate diagnosis and a clear treatment plan, with full respect for the privacy of your medical data.'),
    why: [i('أطباء متخصصون في كل التخصصات', 'Specialist doctors across disciplines'), i('حجز أونلاين بدون انتظار', 'Online booking, no waiting on the phone'), i('خصوصية كاملة لملفك الطبي', 'Strict privacy for your medical file'), i('أسعار معلنة وواضحة', 'Clear, published prices')],
    servicesTitle: i('خدماتنا', 'Our services'), servicesIntro: i('نقدّم مجموعة من الخدمات الطبية تحت سقف واحد.', 'A range of medical services under one roof.'),
    services: [s('الكشف والاستشارات', 'Consultations', 'كشف واستشارة مع أطباء كل التخصصات.', 'Check-ups and consultations with doctors of every specialty.'), s('التحاليل الطبية', 'Laboratory tests', 'تحاليل دقيقة مع نتائج واضحة.', 'Accurate lab tests with clear results.'), s('الأشعة والتصوير', 'Imaging & radiology', 'أشعة وتصوير تشخيصي بتقارير مكتوبة.', 'Diagnostic imaging with written reports.'), s('الصيدلية', 'Pharmacy', 'صرف الأدوية والروشتات داخل المركز.', 'Prescriptions and medicines dispensed on site.')],
  },
  realestate: {
    heroTitle: i('{name} — ابحث عن بيتك القادم', '{name} — find your next property'),
    hero: i('عقارات للبيع والإيجار ومشروعات جديدة، مع فريق مبيعات يرافقك حتى التسليم.', 'Properties for sale and rent and new projects, with a sales team beside you until handover.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} شركة عقارية تساعد العملاء على شراء وبيع وتأجير العقارات بثقة. نعرض لك وحدات حقيقية بأسعار ومساحات واضحة، وننظّم لك المعاينة والتفاوض والتعاقد.', '{name} is a real estate company that helps clients buy, sell and rent with confidence. We list real units with clear prices and areas, and organise viewings, negotiation and contracts for you.'),
    why: [i('عقارات موثّقة ومحدّثة', 'Verified, up-to-date listings'), i('معاينة بموعد يناسبك', 'Viewings at a time that suits you'), i('وسطاء متخصصون في كل منطقة', 'Brokers who know each area'), i('متابعة حتى إتمام الصفقة', 'Support until the deal closes')],
    servicesTitle: i('ماذا نقدّم', 'What we offer'), servicesIntro: i('كل ما يلزمك في رحلة الشراء أو الإيجار.', 'Everything you need on your buying or renting journey.'),
    services: [s('بيع العقارات', 'Property sales', 'شقق وفلل ومحال ووحدات تجارية.', 'Apartments, villas, shops and commercial units.'), s('الإيجار', 'Rentals', 'عقود إيجار منظّمة للسكني والتجاري.', 'Structured rental contracts for homes and businesses.'), s('المشروعات والكمبوندات', 'Projects & compounds', 'وحدات في مشروعات قيد الإنشاء وجاهزة للتسليم.', 'Units in projects under construction and ready to move in.'), s('طلب معاينة', 'Property viewings', 'احجز معاينة وسيتواصل معك فريق المبيعات.', 'Request a viewing and our sales team will contact you.')],
  },
  ecommerce: {
    heroTitle: i('{name} — تسوّق بسهولة وثقة', '{name} — shop easily and safely'),
    hero: i('منتجات أصلية، أسعار واضحة، دفع عند الاستلام أو إلكترونيًا، وتتبّع لطلبك لحد الباب.', 'Genuine products, clear prices, cash on delivery or online payment, and order tracking to your door.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} متجر إلكتروني يقدّم منتجات مختارة بعناية مع تجربة شراء بسيطة: اختَر، أضف للسلة، أكمل الطلب وتابع الشحن. وفي حالة الاستبدال أو الاسترجاع نحن بجانبك.', '{name} is an online store with carefully selected products and a simple buying experience: pick, add to cart, check out and follow delivery. If you need an exchange or return, we are here.'),
    why: [i('منتجات أصلية', 'Genuine products'), i('شحن لكل المحافظات', 'Delivery nationwide'), i('دفع عند الاستلام', 'Cash on delivery'), i('استبدال واسترجاع بسياسة واضحة', 'Clear exchange and return policy')],
    servicesTitle: i('تجربة التسوّق', 'Your shopping experience'), servicesIntro: i('من التصفّح حتى استلام الطلب.', 'From browsing to receiving your order.'),
    services: [s('تسوّق أونلاين', 'Shop online', 'تصفّح الأقسام وابحث وفلتر حسب السعر.', 'Browse categories, search and filter by price.'), s('الشحن والتوصيل', 'Shipping & delivery', 'توصيل سريع مع رقم تتبّع.', 'Fast delivery with a tracking number.'), s('طرق دفع متعددة', 'Flexible payment', 'عند الاستلام أو تحويل إلكتروني.', 'Cash on delivery or electronic transfer.'), s('الاستبدال والاسترجاع', 'Exchanges & returns', 'اطلب الاسترجاع من حسابك.', 'Request a return from your account.')],
  },
  restaurant: {
    heroTitle: i('{name} — طعم يستحق التجربة', '{name} — a taste worth trying'),
    hero: i('اطلب من المنيو أونلاين أو احجز طاولتك، ونحضّر لك أشهى الأطباق طازجة.', 'Order from the menu online or reserve a table — we prepare every dish fresh.'),
    aboutTitle: i('قصتنا', 'Our story'),
    about: i('{name} يقدّم أطباقًا مصنوعة من مكوّنات طازجة وبوصفات ثابتة الجودة. نستقبلك في الفرع أو نوصّل لك الطلب إلى بيتك.', '{name} serves dishes made from fresh ingredients and consistent recipes. Visit us at a branch or have your order delivered home.'),
    why: [i('مكوّنات طازجة يوميًا', 'Fresh ingredients daily'), i('توصيل وتيك أواي', 'Delivery and takeaway'), i('حجز طاولات مسبق', 'Table reservations'), i('عروض دورية', 'Regular offers')],
    servicesTitle: i('ماذا نقدّم', 'What we serve'), servicesIntro: i('طرق متعددة للاستمتاع بوجبتك.', 'Several ways to enjoy your meal.'),
    services: [s('الأكل في المطعم', 'Dine-in', 'طاولات مريحة وخدمة سريعة.', 'Comfortable tables and quick service.'), s('الطلب أونلاين', 'Online ordering', 'اطلب من المنيو مع الإضافات التي تفضّلها.', 'Order from the menu with your favourite extras.'), s('حجز الطاولات', 'Table booking', 'احجز لمجموعتك أو مناسبتك.', 'Reserve for your group or occasion.'), s('العروض', 'Offers', 'عروض أسبوعية على أصناف مختارة.', 'Weekly offers on selected items.')],
  },
  automotive: {
    heroTitle: i('{name} — سيارتك في أيدٍ أمينة', '{name} — your car in safe hands'),
    hero: i('صيانة وقطع غيار وبطاريات، احجز موعدك واطلب عرض سعر بسهولة.', 'Maintenance, spare parts and batteries — book a slot and request a quote with ease.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} مركز صيانة وقطع غيار يخدم أصحاب السيارات بفنيين مدرّبين وقطع مضمونة. نسجّل سيارتك وتاريخ صيانتها حتى تعرف دائمًا ماذا تحتاج بعد ذلك.', '{name} is a service centre and parts shop for car owners, with trained technicians and warranted parts. We keep your vehicle and its service history on file so you always know what is due next.'),
    why: [i('فنيون مدرّبون', 'Trained technicians'), i('قطع غيار مضمونة', 'Warranted spare parts'), i('سجل صيانة لكل سيارة', 'Service history per car'), i('أسعار واضحة قبل التنفيذ', 'Prices agreed before work')],
    servicesTitle: i('خدماتنا', 'Our services'), servicesIntro: i('كل ما تحتاجه سيارتك في مكان واحد.', 'Everything your car needs in one place.'),
    services: [s('الصيانة الدورية', 'Routine maintenance', 'تغيير زيت وفلاتر وفحص شامل.', 'Oil and filter changes and full inspections.'), s('الإصلاحات', 'Repairs', 'تشخيص الأعطال وإصلاحها.', 'Fault diagnosis and repair.'), s('قطع الغيار والبطاريات', 'Parts & batteries', 'قطع أصلية وبدائل موثوقة.', 'Genuine parts and reliable alternatives.'), s('طلب عرض سعر', 'Quote requests', 'أرسل بيانات سيارتك واحصل على سعر.', 'Send your car details and get a price.')],
  },
  learning: {
    heroTitle: i('{name} — تعلّم بخطوات واضحة', '{name} — learn step by step'),
    hero: i('كورسات منظّمة مع مدرّبين متخصصين، وشهادة إتمام بعد النجاح.', 'Structured courses with expert instructors and a certificate when you complete them.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} أكاديمية تعليمية تقدّم كورسات عملية يشرحها مدرّبون متخصصون. تتابع الدروس وتحل الواجبات والاختبارات وتعرف تقدّمك أولًا بأول من حسابك.', '{name} is a learning academy offering practical courses taught by specialists. Follow lessons, do assignments and exams, and see your progress from your account.'),
    why: [i('مدرّبون متخصصون', 'Specialist instructors'), i('دروس مسجّلة ومباشرة', 'Recorded and live lessons'), i('اختبارات وواجبات', 'Exams and assignments'), i('شهادة إتمام موثّقة', 'Verifiable completion certificate')],
    servicesTitle: i('ماذا نقدّم', 'What we offer'), servicesIntro: i('طريقة تعلّم متكاملة من البداية للشهادة.', 'A complete path from enrolment to certificate.'),
    services: [s('كورسات مسجّلة', 'On-demand courses', 'تعلّم في الوقت المناسب لك.', 'Learn at the time that suits you.'), s('حصص مباشرة', 'Live sessions', 'تفاعل مع المدرّب مباشرة.', 'Interact with the instructor live.'), s('اختبارات وشهادات', 'Exams & certificates', 'اختبر نفسك واحصل على شهادة.', 'Test yourself and earn a certificate.'), s('متابعة التقدّم', 'Progress tracking', 'شاهد نسبة إنجازك في كل كورس.', 'See your completion in every course.')],
  },
  construction: {
    heroTitle: i('{name} — نبني بجودة ونلتزم بالموعد', '{name} — built well, delivered on time'),
    hero: i('مقاولات وتشطيبات وتنفيذ هندسي بميزانية واضحة ومتابعة مستمرة.', 'Contracting, finishing and engineering works with a clear budget and steady updates.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} شركة مقاولات وتشطيبات تنفّذ المشروعات من المعاينة والمقايسة حتى التسليم. نلتزم بالميزانية والجدول الزمني ونعرض لك التقدّم والتكلفة أولًا بأول.', '{name} is a contracting and finishing company delivering projects from site visit and estimate to handover. We keep to budget and schedule and show you progress and cost as work advances.'),
    why: [i('مقايسة وتسعير شفاف', 'Transparent estimates'), i('التزام بالجدول والميزانية', 'On schedule, on budget'), i('فريق هندسي وعمّال مهرة', 'Engineers and skilled crews'), i('صور قبل وبعد لأعمالنا', 'Before-and-after proof of our work')],
    servicesTitle: i('خدماتنا', 'Our services'), servicesIntro: i('من الفكرة إلى التسليم.', 'From idea to handover.'),
    services: [s('تشطيب وتجديد', 'Finishing & renovation', 'تشطيب كامل للشقق والفلل والمحال.', 'Full finishing for flats, villas and shops.'), s('مقاولات إنشائية', 'Structural contracting', 'تنفيذ الأعمال الإنشائية والهيكل.', 'Structural and carcass works.'), s('معاينة ومقايسة', 'Inspection & estimate', 'نزور الموقع ونحسب الكميات والتكلفة.', 'We visit the site and price quantities and costs.'), s('طلب عرض سعر', 'Request a quote', 'أرسل تفاصيل مشروعك لنرد عليك.', 'Send your project details and we will reply.')],
  },
  booking: {
    heroTitle: i('{name} — احجز موعدك في ثوانٍ', '{name} — book your slot in seconds'),
    hero: i('اختر الخدمة والموظف والوقت المناسب، وسيصلك تأكيد الحجز.', 'Pick a service, a specialist and a time, and get your booking confirmation.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} يقدّم خدماته بالمواعيد حتى لا تنتظر. تحجز أونلاين، وتختار مقدّم الخدمة، وتعدّل أو تلغي موعدك بنفسك وفق سياسة واضحة.', '{name} works by appointment so you never wait. Book online, choose your provider, and change or cancel your booking yourself under a clear policy.'),
    why: [i('مواعيد بدون تعارض', 'No double bookings'), i('اختيار مقدّم الخدمة', 'Choose your provider'), i('تأكيد وتذكير بالموعد', 'Confirmation and reminders'), i('سياسة إلغاء واضحة', 'Clear cancellation policy')],
    servicesTitle: i('خدماتنا', 'Our services'), servicesIntro: i('اختر الخدمة التي تناسبك.', 'Choose the service that suits you.'),
    services: [s('حجز أونلاين', 'Online booking', 'أوقات متاحة محدّثة لحظيًا.', 'Live, up-to-date availability.'), s('اختيار الموظف', 'Pick your specialist', 'احجز مع مقدّم الخدمة المفضّل لديك.', 'Book with your preferred provider.'), s('تعديل وإلغاء', 'Reschedule & cancel', 'غيّر موعدك بكود الحجز ورقم هاتفك.', 'Change your slot with your code and phone.'), s('عربون عند الحاجة', 'Deposit when required', 'تأكيد الحجز بعربون لبعض الخدمات.', 'Secure some services with a deposit.')],
  },
  fleet: {
    heroTitle: i('{name} — شحن وتوصيل يمكنك الاعتماد عليه', '{name} — shipping you can rely on'),
    hero: i('اطلب شحنتك، احسب التكلفة، وتتبّع طردك برقم التتبّع لحظة بلحظة.', 'Request a shipment, calculate the cost and track your parcel with its tracking number.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} شركة شحن وتوصيل تغطي مناطق متعددة بأسطول ومناديب مدرّبين. نستلم الشحنة، ونوصّلها، ونحصّل المبلغ عند التسليم ونوريك كل مرحلة.', '{name} is a shipping and delivery company covering many areas with a fleet and trained couriers. We collect, deliver, collect cash on delivery and show you every stage.'),
    why: [i('رقم تتبّع لكل شحنة', 'A tracking number for every shipment'), i('تحصيل عند الاستلام', 'Cash on delivery'), i('إثبات تسليم', 'Proof of delivery'), i('تغطية مناطق متعددة', 'Wide area coverage')],
    servicesTitle: i('خدماتنا', 'Our services'), servicesIntro: i('حلول شحن للأفراد والمتاجر.', 'Shipping solutions for individuals and shops.'),
    services: [s('توصيل الطرود', 'Parcel delivery', 'استلام من العميل وتوصيل للمستلم.', 'Pick-up from the sender and delivery to the recipient.'), s('التحصيل عند التسليم', 'Cash on delivery', 'نحصّل المبلغ ونسوّيه معك.', 'We collect the amount and settle it with you.'), s('حاسبة التكلفة', 'Cost calculator', 'اعرف السعر قبل أن تطلب.', 'Know the price before you order.'), s('تتبّع الشحنة', 'Shipment tracking', 'تابع حالة الشحنة برقم التتبّع.', 'Follow your shipment with its tracking number.')],
  },
  business: {
    heroTitle: i('{name} — شريكك في نمو أعمالك', '{name} — your partner in business growth'),
    hero: i('خدمات احترافية وحلول متكاملة لشركتك، وفريق يلتزم بما يعد به.', 'Professional services and complete solutions for your company, from a team that delivers.'),
    aboutTitle: i('من نحن', 'About us'),
    about: i('{name} شركة تقدّم خدمات وحلولًا للشركات بفريق متخصص وخبرة في عدة قطاعات. نفهم احتياجك، نقدّم عرض سعر واضحًا، ونتابع التنفيذ حتى رضاك.', '{name} provides services and solutions to companies, with a specialist team and experience across industries. We understand your need, send a clear quote and follow through until you are satisfied.'),
    why: [i('فريق متخصص', 'A specialist team'), i('عروض أسعار واضحة', 'Clear quotations'), i('خبرة في عدة قطاعات', 'Multi-industry experience'), i('التزام بالمواعيد', 'We keep our deadlines')],
    servicesTitle: i('خدماتنا', 'Our services'), servicesIntro: i('حلول تناسب حجم شركتك.', 'Solutions that fit the size of your company.'),
    services: [s('استشارات وخدمات', 'Consulting & services', 'نحلل احتياجك ونقترح الحل.', 'We analyse your need and propose the solution.'), s('منتجات وتوريد', 'Products & supply', 'توريد منتجات للشركات.', 'Supplying products to companies.'), s('مشروعات سابقة', 'Past projects', 'اطّلع على أعمالنا مع عملائنا.', 'See our work with clients.'), s('طلب عرض سعر', 'Request a quotation', 'أرسل طلبك ونرد بعرض سعر.', 'Send your request and we reply with a quotation.')],
  },
};

export const DEFAULT_HOURS = { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: day === 5, open: '09:00', close: '17:00' })), holidays: [] as { date: string; label: string }[] };

export interface DefaultSection { type: string; enabled: boolean; content: { title?: string; text?: string; items?: { title: string; text?: string }[] } }

/** The sections a new website starts with. */
export function defaultSections(productSlug: string, locale: SiteLocale, name: string): DefaultSection[] {
  const c = SITE_COPY[productSlug]; const l = locale === 'en' ? 'en' : 'ar'; const sub = (x: L) => x[l].replace(/\{name\}/g, name);
  if (!c) return ['hero', 'about', 'services', 'contact'].map((type) => ({ type, enabled: true, content: {} }));
  return [
    { type: 'hero', enabled: true, content: { title: sub(c.heroTitle), text: sub(c.hero) } },
    { type: 'about', enabled: true, content: { title: sub(c.aboutTitle), text: sub(c.about), items: c.why.map((w) => ({ title: sub(w) })) } },
    { type: 'services', enabled: true, content: { title: sub(c.servicesTitle), text: sub(c.servicesIntro), items: c.services.map((x) => ({ title: sub(x.title), text: sub(x.text) })) } },
    { type: 'hours', enabled: true, content: {} },
    { type: 'contact', enabled: true, content: {} },
  ];
}

/** Render-time fallback: a section the owner left completely empty shows the product default instead of a bare heading. */
export function fallbackContent(productSlug: string, type: string, locale: SiteLocale, name: string): DefaultSection['content'] | undefined {
  return defaultSections(productSlug, locale, name).find((x) => x.type === type)?.content;
}
