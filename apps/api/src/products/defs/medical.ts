import { applyBasisPoints } from '@codela/shared';
import { latinDigits, minutesUntilLocal, type EntityDef, type HookCtx, type ProductDef, type RecordRow } from '../framework';
import { enqueue } from '../../outbox';
import { notifyTenant } from '../../notify';

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const INACTIVE_APPT = ['cancelled', 'no_show'];
const APPT_NEXT: Record<string, string[]> = { scheduled: ['confirmed', 'completed', 'cancelled', 'no_show'], confirmed: ['completed', 'cancelled', 'no_show'], completed: [], cancelled: [], no_show: [] };

const specialty: EntityDef = { key: 'specialty', module: 'specialties', labelEn: 'Specialty', labelAr: 'تخصص', titleField: 'name', searchFields: ['name'],
  fields: { name: { type: 'string', required: true, unique: true }, description: { type: 'text' } }, public: { fields: ['name', 'description'] } };

const branch: EntityDef = { key: 'branch', module: 'branches', labelEn: 'Branch', labelAr: 'فرع', titleField: 'name', searchFields: ['name', 'address'], filterable: ['active'],
  fields: { name: { type: 'string', required: true, unique: true }, address: { type: 'string' }, phone: { type: 'phone' }, hours: { type: 'string' }, mapUrl: { type: 'url' }, mapEmbedUrl: { type: 'url' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'address', 'phone', 'hours', 'mapUrl', 'mapEmbedUrl'], filter: { active: true } } };
const doctor: EntityDef = { key: 'doctor', module: 'doctors', labelEn: 'Doctor', labelAr: 'طبيب', titleField: 'name', searchFields: ['name', 'phone', 'email'], filterable: ['specialtyId', 'active'],
  fields: { name: { type: 'string', required: true }, specialtyId: { type: 'ref', entity: 'specialty' }, phone: { type: 'phone' }, email: { type: 'email' }, bio: { type: 'text' },
    consultationFee: { type: 'money' }, image: { type: 'url' }, branchId: { type: 'ref', entity: 'branch' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'bio', 'specialtyId', 'consultationFee', 'image', 'branchId'], filter: { active: true }, filterable: ['specialtyId'] } };

const doctorSchedule: EntityDef = { key: 'doctorSchedule', module: 'schedules', labelEn: 'Doctor schedule', labelAr: 'جدول طبيب', titleField: 'weekday', filterable: ['doctorId', 'weekday'],
  fields: { doctorId: { type: 'ref', entity: 'doctor', required: true }, branchId: { type: 'ref', entity: 'branch' }, weekday: { type: 'int', min: 0, max: 6, required: true }, from: { type: 'time', required: true }, to: { type: 'time', required: true } },
  public: { fields: ['doctorId', 'branchId', 'weekday', 'from', 'to'], filterable: ['doctorId'] }, // working days/hours are shown on the doctor's public profile
  beforeSave: (ctx, { data }) => { if (hm(String(data.from)) >= hm(String(data.to))) ctx.fail(400, 'VALIDATION_ERROR', 'from must be before to'); } };

const service: EntityDef = { key: 'service', module: 'services', labelEn: 'Medical service', labelAr: 'خدمة طبية', titleField: 'name', searchFields: ['name'], filterable: ['specialtyId', 'active'],
  fields: { name: { type: 'string', required: true, unique: true }, specialtyId: { type: 'ref', entity: 'specialty' }, price: { type: 'money', required: true }, durationMin: { type: 'int', min: 5, max: 480, default: 30 }, description: { type: 'text' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'description', 'price', 'durationMin', 'specialtyId'], filter: { active: true } } };


const faq: EntityDef = { key: 'faq', module: 'faqs', labelEn: 'FAQ', labelAr: 'سؤال شائع', titleField: 'question', searchFields: ['question', 'answer'], filterable: ['active'], defaultSort: { field: 'position', dir: 'asc' },
  fields: { question: { type: 'string', required: true, max: 200 }, answer: { type: 'text', required: true }, position: { type: 'int', min: 0, max: 9999, default: 100 }, active: { type: 'bool', default: true } },
  public: { fields: ['question', 'answer', 'position'], filter: { active: true } } };
const article: EntityDef = { key: 'article', module: 'articles', labelEn: 'Article', labelAr: 'مقال طبي', titleField: 'title', searchFields: ['title', 'summary'], filterable: ['published'], defaultSort: { field: 'createdAt', dir: 'desc' },
  fields: { title: { type: 'string', required: true, max: 200 }, summary: { type: 'string', max: 400 }, body: { type: 'text', required: true }, published: { type: 'bool', default: false } },
  public: { fields: ['title', 'summary', 'body'], filter: { published: true } } }; // drafts are never exposed

const patient: EntityDef = { key: 'patient', module: 'patients', labelEn: 'Patient', labelAr: 'مريض', titleField: 'name', subtitleField: '$code', autoCode: 'PT-',
  searchFields: ['name', 'phone', 'email'], filterable: ['gender'], defaultSort: { field: 'createdAt', dir: 'desc' },
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, birthDate: { type: 'date' }, gender: { type: 'enum', values: ['male', 'female'] },
    nationalId: { type: 'string', max: 30, sensitive: true }, address: { type: 'string' }, notes: { type: 'text' } } };

function checkAppointment(ctx: HookCtx, data: Record<string, unknown>, existing?: { id: string; data: Record<string, unknown> }) {
  const status = String(data.status ?? 'scheduled');
  if (existing && existing.data.status !== status && !APPT_NEXT[String(existing.data.status)]?.includes(status))
    ctx.fail(409, 'INVALID_TRANSITION', `Cannot change appointment from ${existing.data.status} to ${status}`);
  if (INACTIVE_APPT.includes(status) || status === 'completed') return;
  const start = hm(String(data.startTime)); const end = start + Number(data.durationMin ?? 30);
  for (const o of ctx.find('appointment', { doctorId: data.doctorId, date: data.date })) {
    if (o.id === existing?.id || INACTIVE_APPT.includes(String(o.data.status))) continue;
    const os = hm(String(o.data.startTime)), oe = os + Number(o.data.durationMin ?? 30);
    if (start < oe && os < end) ctx.fail(409, 'SLOT_TAKEN', 'The doctor already has an appointment in this time slot');
  }
  const sched = ctx.find('doctorSchedule', { doctorId: data.doctorId });
  if (sched.length) {
    const wd = new Date(`${data.date}T00:00:00Z`).getUTCDay();
    if (!sched.some((s) => Number(s.data.weekday) === wd && hm(String(s.data.from)) <= start && end <= hm(String(s.data.to))))
      ctx.fail(409, 'OUTSIDE_SCHEDULE', 'The doctor does not work at this time');
  }
}
const appointment: EntityDef = { key: 'appointment', module: 'appointments', labelEn: 'Appointment', labelAr: 'موعد', titleField: '$code', subtitleField: 'date', autoCode: 'AP-',
  searchFields: ['date'], filterable: ['status', 'doctorId', 'patientId', 'date'], defaultSort: { field: 'date', dir: 'desc' },
  fields: { patientId: { type: 'ref', entity: 'patient', required: true }, doctorId: { type: 'ref', entity: 'doctor', required: true }, serviceId: { type: 'ref', entity: 'service' }, branchId: { type: 'ref', entity: 'branch' },
    date: { type: 'date', required: true }, startTime: { type: 'time', required: true }, durationMin: { type: 'int', min: 5, max: 480, default: 30 },
    status: { type: 'enum', values: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'], default: 'scheduled' }, notes: { type: 'text' } },
  beforeSave: (ctx, { action, data, existing }) => { checkAppointment(ctx, { status: 'scheduled', ...data }, action === 'update' ? existing : undefined); },
  // Patient e-mail when an appointment becomes confirmed (queued in the outbox; delivered by the outbox worker; "no_provider" if e-mail is not configured).
  afterSave: (ctx, { record, previous }) => {
    // Visit finished -> a DRAFT invoice is prepared for reception (service price, else the doctor's consultation fee). Never duplicated; skipped when there is no price.
    if (record.data.status === 'completed' && previous && previous.data.status !== 'completed' && !ctx.find('invoice', { appointmentId: record.id }).length) {
      const svc = record.data.serviceId ? ctx.get(String(record.data.serviceId)) : undefined; const doc = ctx.get(String(record.data.doctorId));
      const price = Number(svc?.data.price ?? doc?.data.consultationFee ?? 0);
      if (price > 0) ctx.createFull('invoice', { patientId: record.data.patientId, appointmentId: record.id, lines: [{ desc: String(svc?.data.name ?? `Consultation — ${doc?.data.name ?? ''}`).trim(), qty: 1, unitPrice: price }] });
    }
    if (record.data.status !== 'confirmed' || previous?.data.status === 'confirmed') return;
    const patient = ctx.get(String(record.data.patientId)); const email = patient?.data.email; if (typeof email !== 'string' || !email) return;
    const doctor = ctx.get(String(record.data.doctorId));
    enqueue(ctx.db, ctx.tenantId, 'email', email, 'appointment_confirmed', { code: record.code, name: patient!.data.name, date: record.data.date, time: record.data.startTime, provider: doctor?.data.name });
  } };


const normPhone = (p: unknown) => latinDigits(String(p ?? '')).replace(/[\s\-().]/g, '');
const pad2 = (n: number) => String(n).padStart(2, '0');
const hmText = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const SLOT_STEP = 15;
/** Free start times (every 15 min) for a doctor on a date: inside the doctor's schedule, not overlapping an active appointment, not in the past. Doctors without a schedule are not bookable online. */
function doctorSlots(ctx: HookCtx, doctorId: string, date: string, durationMin: number, excludeId?: string): Map<string, string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) ctx.fail(400, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD');
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const windows = ctx.find('doctorSchedule', { doctorId }).filter((x) => Number(x.data.weekday) === wd);
  const busy = ctx.find('appointment', { doctorId, date }).filter((a) => a.id !== excludeId && !INACTIVE_APPT.includes(String(a.data.status))).map((a) => [hm(String(a.data.startTime)), hm(String(a.data.startTime)) + Number(a.data.durationMin ?? 30)] as const);
  const out = new Map<string, string | null>();
  for (const w of windows) for (let t = hm(String(w.data.from)); t + durationMin <= hm(String(w.data.to)); t += SLOT_STEP) {
    if (minutesUntilLocal(ctx, date, hmText(t)) <= 0) continue; // the clinic's own clock (Settings -> timezone), not UTC
    if (busy.every(([s, e]) => !(t < e && s < t + durationMin)) && !out.has(hmText(t))) out.set(hmText(t), (w.data.branchId as string | undefined) ?? null);
  }
  return out;
}
const activeDoctor = (ctx: HookCtx, id: unknown): RecordRow => { const d = ctx.get(String(id ?? '')); if (!d || d.entityType !== 'doctor' || d.data.active === false) ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown doctor'); return d!; };
const durationOf = (ctx: HookCtx, serviceId: unknown): { id?: string; min: number } => {
  if (!serviceId) return { min: 30 }; const s = ctx.get(String(serviceId)); if (!s || s.entityType !== 'service' || s.data.active === false) ctx.fail(400, 'REFERENCE_NOT_FOUND', 'Unknown service');
  return { id: s!.id, min: Number(s!.data.durationMin ?? 30) };
};
const apptOf = (ctx: HookCtx, code: unknown, phone: unknown) => {
  const a = ctx.byCode('appointment', String(code ?? '').toUpperCase()); const p = a && ctx.get(String(a.data.patientId));
  if (!a || !p || !normPhone(p.data.phone) || normPhone(p.data.phone) !== normPhone(phone)) ctx.fail(404, 'NOT_FOUND', 'Appointment not found');
  return { a: a!, p: p! };
};

const sensitiveBase = { sensitive: true as const };
const medicalRecord: EntityDef = { key: 'medicalRecord', module: 'records', labelEn: 'Medical record', labelAr: 'سجل طبي', titleField: 'complaint', subtitleField: '$code', autoCode: 'MR-', ...sensitiveBase,
  searchFields: ['complaint', 'diagnosis'], filterable: ['patientId', 'doctorId', 'visitDate'], defaultSort: { field: 'visitDate', dir: 'desc' },
  fields: { patientId: { type: 'ref', entity: 'patient', required: true }, doctorId: { type: 'ref', entity: 'doctor', required: true }, appointmentId: { type: 'ref', entity: 'appointment' },
    visitDate: { type: 'date', required: true }, complaint: { type: 'text', required: true }, diagnosis: { type: 'text' }, treatment: { type: 'text' }, notes: { type: 'text' } } };
const medicalHistory: EntityDef = { key: 'medicalHistory', module: 'records', labelEn: 'Medical history', labelAr: 'تاريخ مرضي', titleField: 'description', ...sensitiveBase,
  searchFields: ['description'], filterable: ['patientId', 'type'],
  fields: { patientId: { type: 'ref', entity: 'patient', required: true }, type: { type: 'enum', values: ['allergy', 'chronic', 'surgery', 'medication', 'family'], required: true }, description: { type: 'text', required: true }, since: { type: 'date' } } };
const prescription: EntityDef = { key: 'prescription', module: 'prescriptions', labelEn: 'Prescription', labelAr: 'روشتة', titleField: '$code', autoCode: 'RX-', ...sensitiveBase, filterable: ['patientId', 'doctorId'],
  fields: { patientId: { type: 'ref', entity: 'patient', required: true }, doctorId: { type: 'ref', entity: 'doctor', required: true }, recordId: { type: 'ref', entity: 'medicalRecord' },
    items: { type: 'lines', required: true, max: 30, fields: { drug: { type: 'string', required: true }, dose: { type: 'string' }, frequency: { type: 'string' }, days: { type: 'int', min: 1, max: 365 } } }, notes: { type: 'text' } } };
/** Lab test catalogue: what the laboratory offers, its price and sample type. Requests reference a test; results are recorded per parameter. */
const labTest: EntityDef = { key: 'labTest', module: 'labTests', labelEn: 'Lab test', labelAr: 'تحليل (كتالوج)', titleField: 'name', subtitleField: 'sampleType', searchFields: ['name', 'code'], filterable: ['active', 'sampleType'],
  fields: { name: { type: 'string', required: true, unique: true, max: 120 }, code: { type: 'string', max: 30 }, sampleType: { type: 'enum', values: ['blood', 'urine', 'stool', 'swab', 'other'], default: 'blood' }, price: { type: 'money', default: 0 }, turnaroundHours: { type: 'int', min: 0, max: 720 }, active: { type: 'bool', default: true } } };
const LAB_NEXT: Record<string, string[]> = { requested: ['sample_collected'], sample_collected: ['resulted'], resulted: [] };
const labRequest: EntityDef = { key: 'labRequest', module: 'labs', labelEn: 'Lab request', labelAr: 'طلب تحليل', titleField: 'test', subtitleField: '$code', autoCode: 'LAB-', ...sensitiveBase,
  searchFields: ['test'], filterable: ['patientId', 'status'],
  fields: { patientId: { type: 'ref', entity: 'patient', required: true }, doctorId: { type: 'ref', entity: 'doctor', required: true }, test: { type: 'string', required: true }, testId: { type: 'ref', entity: 'labTest' },
    status: { type: 'enum', values: ['requested', 'sample_collected', 'resulted'], default: 'requested' }, resultText: { type: 'text' },
    results: { type: 'lines', max: 60, fields: { parameter: { type: 'string', required: true, max: 80 }, value: { type: 'string', required: true, max: 60 }, unit: { type: 'string', max: 20 }, range: { type: 'string', max: 60 } } }, resultedAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    const st = String(data.status ?? 'requested');
    if (action === 'create' && st !== 'requested') ctx.fail(409, 'INVALID_TRANSITION', 'New lab requests start as requested');
    if (existing && existing.data.status !== st) {
      if (!LAB_NEXT[String(existing.data.status)]?.includes(st)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change lab request from ${existing.data.status} to ${st}`);
      if (st === 'resulted') { const hasLines = Array.isArray(data.results) && (data.results as unknown[]).length > 0; if (!data.resultText && !hasLines) ctx.fail(400, 'VALIDATION_ERROR', 'resultText or per-test results are required to record a result'); return { ...data, resultedAt: ctx.now.toISOString() }; }
    }
  } };

function computeInvoice(ctx: HookCtx, data: Record<string, unknown>) {
  const lines = (data.lines as { qty?: number; unitPrice: number }[]) ?? [];
  const subtotal = lines.reduce((a, l) => a + (l.qty ?? 1) * l.unitPrice, 0);
  const discount = Number(data.discount ?? 0);
  if (discount > subtotal) ctx.fail(400, 'VALIDATION_ERROR', 'discount cannot exceed the subtotal');
  const tax = applyBasisPoints(subtotal - discount, Number(data.taxBp ?? 0));
  return { ...data, discount, taxBp: Number(data.taxBp ?? 0), subtotal, tax, total: subtotal - discount + tax };
}
/* ---- Pharmacy: stock is ledger-driven, a dispense prices from the catalogue and moves stock atomically ---- */
const medication: EntityDef = { key: 'medication', module: 'medications', labelEn: 'Medication', labelAr: 'دواء', titleField: 'name', subtitleField: 'sku', searchFields: ['name', 'sku'], filterable: ['active'],
  fields: { name: { type: 'string', required: true }, sku: { type: 'string', required: true, unique: true, max: 40 }, unit: { type: 'string', max: 20 }, price: { type: 'money', required: true }, reorderLevel: { type: 'int', min: 0 }, batchNo: { type: 'string', max: 40 }, expiryDate: { type: 'date' }, stock: { type: 'int', readonly: true }, active: { type: 'bool', default: true } },
  beforeSave: (_c, { action, data, existing }) => ({ ...data, stock: action === 'create' ? 0 : existing!.data.stock }) };
const MED_PLUS = ['in', 'adjust_up'];
const medicationMovement: EntityDef = { key: 'medicationMovement', module: 'pharmacyStock', labelEn: 'Medication movement', labelAr: 'حركة دواء', titleField: '$code', subtitleField: 'type', autoCode: 'MM-', noUpdate: true, noDelete: true, filterable: ['medicationId', 'type'],
  fields: { medicationId: { type: 'ref', entity: 'medication', required: true }, type: { type: 'enum', values: ['in', 'out', 'waste', 'adjust_up', 'adjust_down'], required: true }, qty: { type: 'int', min: 1, required: true }, reason: { type: 'string' }, dispenseId: { type: 'ref', entity: 'dispense' } },
  beforeSave: (ctx, { data }) => { const cur = Number(ctx.get(String(data.medicationId))!.data.stock ?? 0); if (!MED_PLUS.includes(String(data.type)) && Number(data.qty) > cur) ctx.fail(409, 'INSUFFICIENT_STOCK', `Only ${cur} in stock`); },
  afterSave: (ctx, { record }) => { const m = ctx.get(String(record.data.medicationId))!; ctx.patch(m.id, { stock: Number(m.data.stock ?? 0) + (MED_PLUS.includes(String(record.data.type)) ? 1 : -1) * Number(record.data.qty) }); } };
const dispense: EntityDef = { key: 'dispense', module: 'dispensing', labelEn: 'Dispensing', labelAr: 'صرف دواء', titleField: '$code', subtitleField: 'status', autoCode: 'DSP-', ...sensitiveBase, noDelete: true,
  filterable: ['patientId', 'status'], immutableWhen: { field: 'status', values: ['cancelled'] },
  fields: { patientId: { type: 'ref', entity: 'patient' }, prescriptionId: { type: 'ref', entity: 'prescription' }, paymentMethod: { type: 'enum', values: ['cash', 'card'], required: true },
    lines: { type: 'lines', required: true, max: 40, fields: { medicationId: { type: 'ref', entity: 'medication', required: true }, qty: { type: 'int', min: 1, max: 999, required: true } } },
    items: { type: 'lines', readonly: true, fields: {} }, total: { type: 'money', readonly: true }, at: { type: 'datetime', readonly: true }, status: { type: 'enum', values: ['dispensed', 'cancelled'], default: 'dispensed' } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const need = new Map<string, number>(); const items = (data.lines as { medicationId: string; qty: number }[]).map((l) => {
        const m = ctx.get(l.medicationId)!; if (m.data.active === false) ctx.fail(409, 'NOT_AVAILABLE', `${m.data.name} is not available`);
        need.set(m.id, (need.get(m.id) ?? 0) + l.qty); return { medicationId: m.id, name: String(m.data.name), qty: l.qty, unitPrice: Number(m.data.price), lineTotal: Number(m.data.price) * l.qty };
      });
      for (const [id, q] of need) { const m = ctx.get(id)!; if (q > Number(m.data.stock ?? 0)) ctx.fail(409, 'INSUFFICIENT_STOCK', `${m.data.name}: only ${m.data.stock ?? 0} in stock`); }
      return { ...data, items, total: items.reduce((a, i) => a + i.lineTotal, 0), status: 'dispensed', at: ctx.now.toISOString() };
    }
    const out = { ...existing!.data }; if ('status' in data) out.status = data.status; if (out.status !== existing!.data.status && existing!.data.status !== 'dispensed') ctx.fail(409, 'INVALID_TRANSITION', 'Only a dispensed sale can be cancelled');
    return out;
  },
  afterSave: (ctx, { action, record, previous }) => {
    if (action === 'create') for (const i of record.data.items as { medicationId: string; qty: number }[]) ctx.createFull('medicationMovement', { medicationId: i.medicationId, type: 'out', qty: i.qty, reason: `dispense ${record.code}`, dispenseId: record.id });
    else if (record.data.status === 'cancelled' && previous?.data.status !== 'cancelled') for (const i of record.data.items as { medicationId: string; qty: number }[]) ctx.createFull('medicationMovement', { medicationId: i.medicationId, type: 'in', qty: i.qty, reason: `cancel ${record.code}`, dispenseId: record.id });
  } };

/* ---- Radiology: request -> scheduled -> performed -> reported (a report is required) ---- */
const IMG_NEXT: Record<string, string[]> = { requested: ['scheduled', 'performed'], scheduled: ['performed'], performed: ['reported'], reported: [] };
const imagingRequest: EntityDef = { key: 'imagingRequest', module: 'imaging', labelEn: 'Imaging request', labelAr: 'طلب أشعة', titleField: 'bodyPart', subtitleField: '$code', autoCode: 'RAD-', ...sensitiveBase, searchFields: ['bodyPart'], filterable: ['patientId', 'status', 'modality'],
  fields: { patientId: { type: 'ref', entity: 'patient', required: true }, doctorId: { type: 'ref', entity: 'doctor', required: true }, modality: { type: 'enum', values: ['xray', 'ct', 'mri', 'ultrasound', 'other'], required: true }, bodyPart: { type: 'string', required: true },
    status: { type: 'enum', values: ['requested', 'scheduled', 'performed', 'reported'], default: 'requested' }, scheduledAt: { type: 'datetime' }, reportText: { type: 'text' }, reportedAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    const st = String(data.status ?? 'requested');
    if (action === 'create' && st !== 'requested') ctx.fail(409, 'INVALID_TRANSITION', 'New imaging requests start as requested');
    if (existing && existing.data.status !== st) {
      if (!IMG_NEXT[String(existing.data.status)]?.includes(st)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change imaging request from ${existing.data.status} to ${st}`);
      if (st === 'reported') { if (!data.reportText && !existing.data.reportText) ctx.fail(400, 'VALIDATION_ERROR', 'reportText is required to issue a report'); return { ...existing.data, ...data, reportedAt: ctx.now.toISOString() }; }
    }
  } };

const invoice: EntityDef = { key: 'invoice', module: 'invoices', labelEn: 'Invoice', labelAr: 'فاتورة', titleField: '$code', subtitleField: 'status', autoCode: 'INV-',
  filterable: ['status', 'patientId'], immutableWhen: { field: 'status', values: ['paid', 'cancelled'] }, noDelete: true,
  fields: { patientId: { type: 'ref', entity: 'patient', required: true }, appointmentId: { type: 'ref', entity: 'appointment' },
    lines: { type: 'lines', required: true, max: 100, fields: { desc: { type: 'string', required: true }, qty: { type: 'int', min: 1, default: 1 }, unitPrice: { type: 'money', required: true } } },
    discount: { type: 'money', default: 0 }, taxBp: { type: 'int', min: 0, max: 10000, default: 0 }, notes: { type: 'text' },
    status: { type: 'enum', values: ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'], default: 'draft' },
    subtotal: { type: 'money', readonly: true }, tax: { type: 'money', readonly: true }, total: { type: 'money', readonly: true }, paidAmount: { type: 'money', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') return { ...computeInvoice(ctx, { ...data, status: 'draft' }), status: 'draft', paidAmount: 0 };
    const prev = String(existing!.data.status); const next = String(data.status);
    if (prev !== 'draft') { // issued / partially paid: only cancellation (when nothing was paid) is allowed
      const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(existing!.data[k]));
      if (changed.some((k) => k !== 'status') || (next !== prev && !(next === 'cancelled' && Number(existing!.data.paidAmount) === 0)))
        ctx.fail(409, 'IMMUTABLE', 'Issued invoices can only be cancelled (when unpaid)');
    } else if (next !== 'draft' && !['issued', 'cancelled'].includes(next)) ctx.fail(409, 'INVALID_TRANSITION', 'A draft invoice can only be issued or cancelled');
    return { ...computeInvoice(ctx, data), paidAmount: existing!.data.paidAmount };
  } };
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true,
  filterable: ['invoiceId', 'method'],
  fields: { invoiceId: { type: 'ref', entity: 'invoice', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer', 'insurance'], required: true }, paidAt: { type: 'datetime' }, note: { type: 'string' } },
  beforeSave: (ctx, { data }) => {
    const inv = ctx.get(String(data.invoiceId))!;
    if (!['issued', 'partially_paid'].includes(String(inv.data.status))) ctx.fail(409, 'INVOICE_NOT_PAYABLE', 'Payments can only be recorded on issued invoices');
    if (Number(data.amount) > Number(inv.data.total) - Number(inv.data.paidAmount)) ctx.fail(409, 'OVERPAYMENT', 'Payment exceeds the outstanding balance');
    return { ...data, paidAt: data.paidAt ?? ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => {
    const inv = ctx.get(String(record.data.invoiceId))!; const paid = Number(inv.data.paidAmount) + Number(record.data.amount);
    ctx.patch(inv.id, { paidAmount: paid, status: paid >= Number(inv.data.total) ? 'paid' : 'partially_paid' });
  } };

const inquiry: EntityDef = { key: 'inquiry', module: 'inquiries', labelEn: 'Inquiry', labelAr: 'استفسار', titleField: 'name', searchFields: ['name', 'phone', 'email', 'message'], filterable: ['status'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' }, message: { type: 'text', required: true }, status: { type: 'enum', values: ['new', 'handled'], default: 'new' } } };
const appointmentRequest: EntityDef = { key: 'appointmentRequest', module: 'appointmentRequests', labelEn: 'Appointment request', labelAr: 'طلب حجز', titleField: 'name', searchFields: ['name', 'phone'], filterable: ['status'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, doctorId: { type: 'ref', entity: 'doctor' }, serviceId: { type: 'ref', entity: 'service' },
    preferredDate: { type: 'date' }, preferredTime: { type: 'time' }, message: { type: 'text' }, status: { type: 'enum', values: ['new', 'converted', 'rejected'], default: 'new' } } };

export const medical: ProductDef = {
  slug: 'medical',
  entities: [specialty, branch, doctor, doctorSchedule, service, patient, appointment, medicalRecord, medicalHistory, prescription, labTest, labRequest, imagingRequest, medication, medicationMovement, dispense, invoice, payment, faq, article, inquiry, appointmentRequest],
  kpis: [
    { key: 'pharmacySalesMonth', labelEn: 'Pharmacy sales (month)', labelAr: 'مبيعات الصيدلية (الشهر)', entity: 'dispense', agg: 'sum', field: 'total', where: { status: 'dispensed' }, period: 'month', dateField: 'at', money: true },
    { key: 'openImaging', labelEn: 'Open imaging requests', labelAr: 'طلبات أشعة مفتوحة', entity: 'imagingRequest', agg: 'count', where: { status: ['requested', 'scheduled', 'performed'] } },
    { key: 'patients', labelEn: 'Patients', labelAr: 'المرضى', entity: 'patient', agg: 'count' },
    { key: 'doctors', labelEn: 'Doctors', labelAr: 'الأطباء', entity: 'doctor', agg: 'count' },
    { key: 'appointmentsToday', labelEn: 'Appointments today', labelAr: 'مواعيد اليوم', entity: 'appointment', agg: 'count', period: 'today', dateField: 'date' },
    { key: 'revenueMonth', labelEn: 'Revenue this month', labelAr: 'إيراد الشهر', entity: 'payment', agg: 'sum', field: 'amount', period: 'month', dateField: 'paidAt', money: true },
    { key: 'outstanding', labelEn: 'Outstanding invoices', labelAr: 'فواتير مستحقة', entity: 'invoice', agg: 'sum', field: 'total', minusField: 'paidAmount', where: { status: ['issued', 'partially_paid'] }, money: true },
  ],
  reports: [
    { key: 'appointmentsByStatus', labelEn: 'Appointments by status', labelAr: 'المواعيد حسب الحالة', entity: 'appointment', groupBy: 'status', agg: 'count' },
    { key: 'invoicesByStatus', labelEn: 'Invoices by status', labelAr: 'الفواتير حسب الحالة', entity: 'invoice', groupBy: 'status', agg: 'count' },
    { key: 'revenueByMethod', labelEn: 'Revenue by payment method', labelAr: 'الإيراد حسب طريقة الدفع', entity: 'payment', groupBy: 'method', agg: 'sum', field: 'amount' },
  ],
  publicForms: [
    { key: 'inquiry', entity: 'inquiry', fields: ['name', 'phone', 'email', 'message'] },
    { key: 'appointmentRequest', entity: 'appointmentRequest', fields: ['name', 'phone', 'doctorId', 'serviceId', 'preferredDate', 'preferredTime', 'message'] },
  ],
  publicActions: [
    { key: 'availability', method: 'GET', write: false, handler: (ctx, q) => {
      const dur = durationOf(ctx, q.serviceId).min; const date = String(q.date ?? '');
      const docs = ctx.find('doctor', {}).filter((d) => d.data.active !== false && (!q.doctorId || d.id === String(q.doctorId)) && (!q.specialtyId || d.data.specialtyId === String(q.specialtyId)));
      return docs.map((d) => ({ doctorId: d.id, doctorName: d.data.name, specialtyId: d.data.specialtyId ?? null, fee: d.data.consultationFee ?? null, slots: [...doctorSlots(ctx, d.id, date, dur).keys()].sort(), branches: Object.fromEntries([...doctorSlots(ctx, d.id, date, dur)].filter(([, b]) => b)) })).filter((x) => x.slots.length);
    } },
    { key: 'book', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
      const doc = activeDoctor(ctx, b.doctorId); const sv = durationOf(ctx, b.serviceId); const date = String(b.date ?? ''), time = String(b.startTime ?? '');
      const pin = (b.patient ?? {}) as Record<string, unknown>; const phone = normPhone(pin.phone); const name = String(pin.name ?? '').trim();
      if (name.length < 2 || phone.length < 7) ctx.fail(400, 'VALIDATION_ERROR', 'patient name and phone are required');
      const free = doctorSlots(ctx, doc.id, date, sv.min); if (!free.has(time)) ctx.fail(409, 'SLOT_TAKEN', 'This time is no longer available');
      // an existing patient (same phone) is reused and never overwritten by public input; a new one gets only the public fields
      const patient = ctx.find('patient', { phone })[0] ?? ctx.createFull('patient', { name, phone, ...(pin.email ? { email: pin.email } : {}) });
      const a = ctx.createFull('appointment', { patientId: patient.id, doctorId: doc.id, serviceId: sv.id, date, startTime: time, durationMin: sv.min, status: 'scheduled', notes: 'Booked online', ...(free.get(time) ? { branchId: free.get(time) } : {}) });
      notifyTenant(ctx.db, ctx.tenantId, 'appointment', `New online appointment ${a.code}`, `${patient.data.name} — ${date} ${time} — ${doc.data.name}`);
      if (typeof patient.data.email === 'string' && patient.data.email) enqueue(ctx.db, ctx.tenantId, 'email', patient.data.email, 'booking_created', { code: a.code, name: patient.data.name, date, time, provider: doc.data.name });
      return { code: a.code, status: a.data.status, date, startTime: time, doctorName: doc.data.name, durationMin: sv.min };
    } },
    { key: 'status', method: 'GET', write: false, handler: (ctx, q) => {
      const { a } = apptOf(ctx, q.code, q.phone); const d = ctx.get(String(a.data.doctorId));
      return { code: a.code, status: a.data.status, date: a.data.date, startTime: a.data.startTime, durationMin: a.data.durationMin, doctorName: d?.data.name ?? null };
    } },
    { key: 'reschedule', method: 'POST', write: true, status: 200, handler: (ctx, b) => {
      const { a, p } = apptOf(ctx, b.code, b.phone);
      if (!['scheduled', 'confirmed'].includes(String(a.data.status))) ctx.fail(409, 'NOT_RESCHEDULABLE', 'This appointment can no longer be rescheduled');
      const date = String(b.date ?? ''), time = String(b.startTime ?? ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) ctx.fail(400, 'VALIDATION_ERROR', 'date and startTime are required');
      const free = doctorSlots(ctx, String(a.data.doctorId), date, Number(a.data.durationMin ?? 30), a.id);
      if (!free.has(time)) ctx.fail(409, 'SLOT_TAKEN', 'This time is not available');
      ctx.patch(a.id, { date, startTime: time, ...(free.get(time) ? { branchId: free.get(time) } : {}) });
      notifyTenant(ctx.db, ctx.tenantId, 'appointment', `Appointment ${a.code} rescheduled by the patient`, `${p.data.name} — ${date} ${time}`);
      return { code: a.code, status: a.data.status, date, startTime: time };
    } },
    { key: 'cancel', method: 'POST', write: true, status: 200, handler: (ctx, b) => {
      const { a, p } = apptOf(ctx, b.code, b.phone);
      if (!['scheduled', 'confirmed'].includes(String(a.data.status))) ctx.fail(409, 'NOT_CANCELLABLE', 'This appointment can no longer be cancelled');
      ctx.patch(a.id, { status: 'cancelled' });
      notifyTenant(ctx.db, ctx.tenantId, 'appointment', `Appointment ${a.code} cancelled by the patient`, `${p.data.name} — ${a.data.date} ${a.data.startTime}`);
      return { code: a.code, status: 'cancelled' };
    } },
  ],
  // specialised staff: the API gives each role only its own modules (nothing outside them)
  roles: {
    pharmacist: { labelEn: 'Pharmacist', labelAr: 'صيدلي', modules: { medications: ['read', 'create', 'update'], pharmacyStock: ['read', 'create'], dispensing: ['read', 'create', 'update'], prescriptions: ['read'], patients: ['read'] } },
    lab_technician: { labelEn: 'Laboratory technician', labelAr: 'فني معمل', modules: { labs: ['read', 'update'], labTests: ['read', 'create', 'update'], patients: ['read'] } },
    radiology_technician: { labelEn: 'Radiology technician', labelAr: 'فني أشعة', modules: { imaging: ['read', 'update'], patients: ['read'] } },
  },
  employeeModules: { patients: ['read', 'create', 'update'], appointments: ['read', 'create', 'update'], doctors: ['read'], specialties: ['read'], services: ['read'], schedules: ['read'],
    invoices: ['read', 'create', 'update'], payments: ['read', 'create'], inquiries: ['read', 'update'], appointmentRequests: ['read', 'update'] },
};
