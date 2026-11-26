import { applyBasisPoints } from '@codela/shared';
import { notifyTenant } from '../../notify';
import { validateData, type EntityDef, type HookCtx, type ProductDef, type RecordRow } from '../framework';

const nameOnly = (key: string, module: string, en: string, ar: string, extra: EntityDef['fields'] = {}, pub = true): EntityDef => ({
  key, module, labelEn: en, labelAr: ar, titleField: 'name', searchFields: ['name'], fields: { name: { type: 'string', required: true, unique: true }, ...extra },
  ...(pub ? { public: { fields: ['name', ...Object.keys(extra)] } } : {}) });

const propertyType = nameOnly('propertyType', 'propertyTypes', 'Property type', 'نوع العقار');
const location = nameOnly('location', 'locations', 'Location', 'منطقة', { city: { type: 'string' } });
const project: EntityDef = { key: 'project', module: 'projects', labelEn: 'Project', labelAr: 'مشروع', titleField: 'name', searchFields: ['name', 'developer'], filterable: ['locationId', 'status'],
  fields: { name: { type: 'string', required: true, unique: true }, locationId: { type: 'ref', entity: 'location' }, developer: { type: 'string' }, description: { type: 'text' },
    status: { type: 'enum', values: ['planning', 'under_construction', 'ready', 'delivered'], default: 'planning' }, deliveryDate: { type: 'date' } },
  public: { fields: ['name', 'locationId', 'developer', 'description', 'status', 'deliveryDate'], filterable: ['locationId', 'status'] } };

const AVAIL = ['available', 'inactive'];
const property: EntityDef = { key: 'property', module: 'properties', labelEn: 'Property', labelAr: 'عقار', titleField: 'title', subtitleField: '$code', autoCode: 'PR-', searchFields: ['title', 'description'],
  filterable: ['purpose', 'status', 'typeId', 'locationId', 'projectId', 'brokerId', 'price', 'area', 'bedrooms', 'bathrooms', 'featured'],
  fields: { title: { type: 'string', required: true }, purpose: { type: 'enum', values: ['sale', 'rent'], required: true }, typeId: { type: 'ref', entity: 'propertyType', required: true },
    locationId: { type: 'ref', entity: 'location', required: true }, projectId: { type: 'ref', entity: 'project' }, brokerId: { type: 'ref', entity: 'broker' },
    price: { type: 'money', required: true }, area: { type: 'int', min: 0 }, bedrooms: { type: 'int', min: 0, max: 50 }, bathrooms: { type: 'int', min: 0, max: 50 }, floor: { type: 'int', min: -5, max: 200 },
    description: { type: 'text' }, features: { type: 'text' }, featured: { type: 'bool', default: false },
    address: { type: 'string' }, lat: { type: 'string', max: 20 }, lng: { type: 'string', max: 20 }, mapUrl: { type: 'url' }, mapEmbedUrl: { type: 'url' }, videoUrl: { type: 'url' },
    images: { type: 'lines', max: 40, fields: { url: { type: 'url', required: true }, caption: { type: 'string' } } },
    status: { type: 'enum', values: ['available', 'reserved', 'sold', 'rented', 'inactive'], default: 'available' } },
  beforeSave: (ctx, { action, data, existing }) => {
    // coordinates are optional decimal degrees ("30.0444"); both or neither, inside the valid range
    const lat = String(data.lat ?? '').trim(), lng = String(data.lng ?? '').trim();
    if (lat || lng) {
      const ok = (v: string, max: number) => /^-?\d{1,3}(\.\d{1,8})?$/.test(v) && Math.abs(Number(v)) <= max;
      if (!lat || !lng) ctx.fail(400, 'VALIDATION_ERROR', 'Enter both latitude and longitude, or neither');
      if (!ok(lat, 90)) ctx.fail(400, 'VALIDATION_ERROR', 'Latitude must be between -90 and 90');
      if (!ok(lng, 180)) ctx.fail(400, 'VALIDATION_ERROR', 'Longitude must be between -180 and 180');
    }
    const st = String(data.status ?? 'available');
    if (action === 'create' && !AVAIL.includes(st)) ctx.fail(409, 'INVALID_TRANSITION', 'New properties are available or inactive');
    if (existing && st !== existing.data.status && !(AVAIL.includes(st) && AVAIL.includes(String(existing.data.status)))) ctx.fail(409, 'IMMUTABLE', 'Availability is managed by sales and rental contracts');
  },
  public: { fields: ['title', 'purpose', 'typeId', 'locationId', 'projectId', 'price', 'area', 'bedrooms', 'bathrooms', 'floor', 'description', 'features', 'images', 'featured', 'address', 'lat', 'lng', 'mapUrl', 'mapEmbedUrl', 'videoUrl'],
    filter: { status: 'available' }, filterable: ['purpose', 'typeId', 'locationId', 'projectId', 'price', 'area', 'bedrooms', 'bathrooms', 'featured'] } };

const unit: EntityDef = { key: 'unit', module: 'units', labelEn: 'Unit', labelAr: 'وحدة', titleField: 'unitNumber', subtitleField: '$code', autoCode: 'UN-', searchFields: ['unitNumber'], filterable: ['projectId', 'status', 'bedrooms', 'price'],
  fields: { projectId: { type: 'ref', entity: 'project', required: true }, unitNumber: { type: 'string', required: true }, floor: { type: 'int', min: -5, max: 200 }, area: { type: 'int', min: 0 },
    bedrooms: { type: 'int', min: 0, max: 50 }, bathrooms: { type: 'int', min: 0, max: 50 }, price: { type: 'money' }, status: { type: 'enum', values: ['available', 'reserved', 'sold'], default: 'available' } },
  beforeSave: (ctx, { action, data, existing }) => { if ((action === 'create' && data.status !== 'available') || (existing && data.status !== existing.data.status && existing.data.status !== 'available' && data.status !== 'available')) ctx.fail(409, 'IMMUTABLE', 'Unit availability is managed by sales'); },
  public: { fields: ['projectId', 'unitNumber', 'floor', 'area', 'bedrooms', 'bathrooms', 'price'], filter: { status: 'available' }, filterable: ['projectId', 'bedrooms', 'price', 'area'] } };

const broker: EntityDef = { key: 'broker', module: 'brokers', labelEn: 'Broker', labelAr: 'وسيط', titleField: 'name', searchFields: ['name', 'phone', 'email'], filterable: ['active'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, commissionBp: { type: 'int', min: 0, max: 10000, default: 250 }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'phone', 'email'], filter: { active: true } } };
const client: EntityDef = { key: 'client', module: 'clients', labelEn: 'Client', labelAr: 'عميل', titleField: 'name', subtitleField: '$code', autoCode: 'CL-', searchFields: ['name', 'phone', 'email'], filterable: ['type'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, type: { type: 'enum', values: ['buyer', 'tenant', 'investor', 'seller', 'landlord'], default: 'buyer' }, notes: { type: 'text' },
    // what the client is looking for (customer requirements)
    wantsPurpose: { type: 'enum', values: ['sale', 'rent'] }, preferredLocationId: { type: 'ref', entity: 'location' }, preferredTypeId: { type: 'ref', entity: 'propertyType' },
    budgetMin: { type: 'money' }, budgetMax: { type: 'money' }, minBedrooms: { type: 'int', min: 0, max: 50 }, requirements: { type: 'text' } } };
const lead: EntityDef = { key: 'lead', module: 'leads', labelEn: 'Lead', labelAr: 'عميل محتمل', titleField: 'name', subtitleField: '$code', autoCode: 'LD-', searchFields: ['name', 'phone', 'email'], filterable: ['stage', 'brokerId', 'source'],
  immutableWhen: { field: 'stage', values: ['won', 'lost'] },
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone' }, email: { type: 'email' }, source: { type: 'enum', values: ['website', 'referral', 'walk_in', 'call', 'social', 'other'], default: 'other' },
    propertyId: { type: 'ref', entity: 'property' }, brokerId: { type: 'ref', entity: 'broker' }, stage: { type: 'enum', values: ['new', 'contacted', 'viewing', 'negotiation', 'won', 'lost'], default: 'new' }, budget: { type: 'money' }, notes: { type: 'text' } } };
const inquiry: EntityDef = { key: 'inquiry', module: 'inquiries', labelEn: 'Inquiry', labelAr: 'استفسار', titleField: 'name', searchFields: ['name', 'phone', 'email', 'message'], filterable: ['status', 'propertyId'],
  fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' }, propertyId: { type: 'ref', entity: 'property' }, message: { type: 'text' }, status: { type: 'enum', values: ['new', 'handled'], default: 'new' } } };

const VIEW_NEXT: Record<string, string[]> = { requested: ['scheduled', 'cancelled'], scheduled: ['done', 'no_show', 'cancelled'] };
const viewing: EntityDef = { key: 'viewing', module: 'viewings', labelEn: 'Viewing', labelAr: 'معاينة', titleField: '$code', subtitleField: 'status', autoCode: 'VW-', searchFields: ['visitorName', 'visitorPhone'],
  filterable: ['status', 'propertyId', 'unitId', 'brokerId', 'leadId', 'date'], immutableWhen: { field: 'status', values: ['done', 'cancelled', 'no_show'] },
  fields: { propertyId: { type: 'ref', entity: 'property' }, unitId: { type: 'ref', entity: 'unit' }, leadId: { type: 'ref', entity: 'lead', required: true }, clientId: { type: 'ref', entity: 'client' }, brokerId: { type: 'ref', entity: 'broker' },
    date: { type: 'date', required: true }, startTime: { type: 'time' }, visitorName: { type: 'string' }, visitorPhone: { type: 'phone' }, notes: { type: 'text' },
    status: { type: 'enum', values: ['requested', 'scheduled', 'done', 'no_show', 'cancelled'], default: 'requested' } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      if (!!data.propertyId === !!data.unitId) ctx.fail(400, 'VALIDATION_ERROR', 'Provide exactly one of propertyId or unitId');
      const t = ctx.get(String(data.propertyId ?? data.unitId))!;
      if (t.data.status !== 'available') ctx.fail(409, 'NOT_AVAILABLE', 'This property/unit is not available for viewing');
      if (!['requested', 'scheduled'].includes(String(data.status ?? 'requested'))) ctx.fail(409, 'INVALID_TRANSITION', 'New viewings are requested or scheduled');
    } else {
      const prev = String(existing!.data.status), next = String(data.status);
      if (next !== prev && !VIEW_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change viewing from ${prev} to ${next}`);
      if (data.propertyId !== existing!.data.propertyId || data.unitId !== existing!.data.unitId) ctx.fail(409, 'IMMUTABLE', 'The viewed property cannot be changed');
    }
    if (data.status === 'scheduled') { // a scheduled viewing needs a broker and a time, and a broker cannot be in two places at once
      if (!data.brokerId || !data.startTime) ctx.fail(400, 'VALIDATION_ERROR', 'A scheduled viewing needs a broker and a start time');
      const clash = ctx.find('viewing', { brokerId: data.brokerId, date: data.date, startTime: data.startTime, status: 'scheduled' }).filter((v) => v.id !== existing?.id);
      if (clash.length) ctx.fail(409, 'BROKER_BUSY', 'This broker already has a viewing at that time');
    }
  },
  afterSave: (ctx, { record, previous }) => {
    if (record.data.status !== 'scheduled' || previous?.data.status === 'scheduled' || !record.data.leadId) return;
    const lead = ctx.get(String(record.data.leadId)); if (lead && ['new', 'contacted'].includes(String(lead.data.stage))) ctx.patch(lead.id, { stage: 'viewing' });
  } };

const followUp: EntityDef = { key: 'followUp', module: 'followUps', labelEn: 'Follow-up', labelAr: 'متابعة', titleField: 'type', subtitleField: 'nextActionDate', searchFields: ['note'], filterable: ['leadId', 'type'], noDelete: true,
  fields: { leadId: { type: 'ref', entity: 'lead', required: true }, type: { type: 'enum', values: ['call', 'whatsapp', 'meeting', 'email', 'note'], required: true }, note: { type: 'text', required: true }, nextActionDate: { type: 'date' } } };

function target(ctx: HookCtx, d: Record<string, unknown>): RecordRow {
  const id = String(d.propertyId ?? d.unitId);
  return ctx.get(id)!;
}
const DEAL_NEXT: Record<string, string[]> = { reserved: ['contracted', 'cancelled'], contracted: ['completed', 'cancelled'] };
const saleDeal: EntityDef = { key: 'saleDeal', module: 'sales', labelEn: 'Sale deal', labelAr: 'صفقة بيع', titleField: '$code', subtitleField: 'status', autoCode: 'SD-', filterable: ['status', 'brokerId', 'clientId'],
  immutableWhen: { field: 'status', values: ['completed', 'cancelled'] },
  fields: { propertyId: { type: 'ref', entity: 'property' }, unitId: { type: 'ref', entity: 'unit' }, clientId: { type: 'ref', entity: 'client', required: true }, brokerId: { type: 'ref', entity: 'broker', required: true },
    price: { type: 'money', min: 1, required: true }, status: { type: 'enum', values: ['reserved', 'contracted', 'completed', 'cancelled'], default: 'reserved' }, completedAt: { type: 'datetime', readonly: true }, notes: { type: 'text' } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      if (!!data.propertyId === !!data.unitId) ctx.fail(400, 'VALIDATION_ERROR', 'Provide exactly one of propertyId or unitId');
      const t = target(ctx, data);
      const ok = t.data.status === 'available' && (t.entityType === 'unit' || t.data.purpose === 'sale');
      if (!ok) ctx.fail(409, 'NOT_AVAILABLE', 'This property/unit is not available for sale');
      return { ...data, status: 'reserved' };
    }
    const prev = String(existing!.data.status), next = String(data.status);
    if (next !== prev && !DEAL_NEXT[prev]?.includes(next)) ctx.fail(409, 'INVALID_TRANSITION', `Cannot change deal from ${prev} to ${next}`);
    return { ...data, propertyId: existing!.data.propertyId, unitId: existing!.data.unitId };
  },
  afterSave: (ctx, { action, record, previous }) => {
    const t = target(ctx, record.data);
    if (action === 'create') return void ctx.patch(t.id, { status: 'reserved' });
    if (record.data.status === previous!.data.status) return;
    if (record.data.status === 'cancelled') ctx.patch(t.id, { status: 'available' });
    if (record.data.status === 'completed') {
      ctx.patch(t.id, { status: 'sold' }); ctx.patch(record.id, { completedAt: ctx.now.toISOString() });
      const broker = ctx.get(String(record.data.brokerId))!;
      ctx.create('commission', { dealId: record.id, brokerId: broker.id, amount: applyBasisPoints(Number(record.data.price), Number(broker.data.commissionBp ?? 0)), status: 'pending' });
    }
  } };

const rentalContract: EntityDef = { key: 'rentalContract', module: 'rentals', labelEn: 'Rental contract', labelAr: 'عقد إيجار', titleField: '$code', subtitleField: 'status', autoCode: 'RC-', filterable: ['status', 'propertyId', 'clientId'],
  immutableWhen: { field: 'status', values: ['ended', 'terminated'] },
  fields: { propertyId: { type: 'ref', entity: 'property', required: true }, clientId: { type: 'ref', entity: 'client', required: true }, brokerId: { type: 'ref', entity: 'broker' },
    monthlyRent: { type: 'money', min: 1, required: true }, deposit: { type: 'money', default: 0 }, startDate: { type: 'date', required: true }, endDate: { type: 'date', required: true },
    status: { type: 'enum', values: ['active', 'ended', 'terminated'], default: 'active' } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (String(data.endDate) <= String(data.startDate)) ctx.fail(400, 'VALIDATION_ERROR', 'endDate must be after startDate');
    if (action === 'create') {
      const p = ctx.get(String(data.propertyId))!;
      if (p.data.purpose !== 'rent' || p.data.status !== 'available') ctx.fail(409, 'NOT_AVAILABLE', 'This property is not available for rent');
      return { ...data, status: 'active' };
    }
    return { ...data, propertyId: existing!.data.propertyId };
  },
  afterSave: (ctx, { action, record }) => {
    if (action === 'create') ctx.patch(String(record.data.propertyId), { status: 'rented' });
    else if (record.data.status !== 'active') ctx.patch(String(record.data.propertyId), { status: 'available' });
  } };

const commission: EntityDef = { key: 'commission', module: 'commissions', labelEn: 'Commission', labelAr: 'عمولة', titleField: '$code', subtitleField: 'status', autoCode: 'CM-', noCreate: true, noDelete: true,
  filterable: ['status', 'brokerId'], immutableWhen: { field: 'status', values: ['paid'] },
  fields: { dealId: { type: 'ref', entity: 'saleDeal', readonly: true }, brokerId: { type: 'ref', entity: 'broker', readonly: true }, amount: { type: 'money', readonly: true },
    status: { type: 'enum', values: ['pending', 'paid'], default: 'pending' }, paidAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { data, existing }) => { if (data.status === 'paid' && existing!.data.status !== 'paid') return { ...data, paidAt: ctx.now.toISOString() }; } };

const document: EntityDef = { key: 'document', module: 'documents', labelEn: 'Document', labelAr: 'مستند', titleField: 'title', searchFields: ['title'], filterable: ['type', 'dealId', 'clientId', 'propertyId'],
  fields: { title: { type: 'string', required: true }, type: { type: 'enum', values: ['contract', 'id', 'deed', 'other'], default: 'other' }, url: { type: 'url', required: true },
    dealId: { type: 'ref', entity: 'saleDeal' }, clientId: { type: 'ref', entity: 'client' }, propertyId: { type: 'ref', entity: 'property' } } };

export const realestate: ProductDef = {
  slug: 'realestate',
  entities: [propertyType, location, project, property, unit, broker, client, lead, followUp, inquiry, viewing, saleDeal, rentalContract, commission, document],
  kpis: [
    { key: 'propertiesAvailable', labelEn: 'Available properties', labelAr: 'عقارات متاحة', entity: 'property', agg: 'count', where: { status: 'available' } },
    { key: 'unitsAvailable', labelEn: 'Available units', labelAr: 'وحدات متاحة', entity: 'unit', agg: 'count', where: { status: 'available' } },
    { key: 'leadsOpen', labelEn: 'Open leads', labelAr: 'عملاء محتملون', entity: 'lead', agg: 'count', where: { stage: ['new', 'contacted', 'viewing', 'negotiation'] } },
    { key: 'salesValueMonth', labelEn: 'Sales this month', labelAr: 'مبيعات الشهر', entity: 'saleDeal', agg: 'sum', field: 'price', where: { status: 'completed' }, period: 'month', dateField: 'completedAt', money: true },
    { key: 'rentalsActive', labelEn: 'Active rentals', labelAr: 'إيجارات سارية', entity: 'rentalContract', agg: 'count', where: { status: 'active' } },
    { key: 'commissionsPending', labelEn: 'Pending commissions', labelAr: 'عمولات مستحقة', entity: 'commission', agg: 'sum', field: 'amount', where: { status: 'pending' }, money: true },
  ],
  reports: [
    { key: 'propertiesByStatus', labelEn: 'Properties by status', labelAr: 'العقارات حسب الحالة', entity: 'property', groupBy: 'status', agg: 'count' },
    { key: 'leadsByStage', labelEn: 'Leads by stage', labelAr: 'العملاء المحتملون حسب المرحلة', entity: 'lead', groupBy: 'stage', agg: 'count' },
    // lead performance: totals and outcomes per source and per broker (the screen turns these into win rates)
    { key: 'leadsBySource', labelEn: 'Leads by source', labelAr: 'العملاء المحتملون حسب المصدر', entity: 'lead', groupBy: 'source', agg: 'count' },
    { key: 'leadsWonBySource', labelEn: 'Won leads by source', labelAr: 'العملاء المكسوبون حسب المصدر', entity: 'lead', groupBy: 'source', agg: 'count', where: { stage: 'won' } },
    { key: 'leadsLostBySource', labelEn: 'Lost leads by source', labelAr: 'العملاء الخاسرون حسب المصدر', entity: 'lead', groupBy: 'source', agg: 'count', where: { stage: 'lost' } },
    { key: 'leadsByBroker', labelEn: 'Leads by broker', labelAr: 'العملاء المحتملون حسب الوسيط', entity: 'lead', groupBy: 'brokerId', agg: 'count' },
    { key: 'leadsWonByBroker', labelEn: 'Won leads by broker', labelAr: 'العملاء المكسوبون حسب الوسيط', entity: 'lead', groupBy: 'brokerId', agg: 'count', where: { stage: 'won' } },
    { key: 'leadsLostByBroker', labelEn: 'Lost leads by broker', labelAr: 'العملاء الخاسرون حسب الوسيط', entity: 'lead', groupBy: 'brokerId', agg: 'count', where: { stage: 'lost' } },
    { key: 'dealsByStatus', labelEn: 'Deals by status', labelAr: 'الصفقات حسب الحالة', entity: 'saleDeal', groupBy: 'status', agg: 'count' },
    { key: 'salesByBroker', labelEn: 'Broker performance (sales value)', labelAr: 'أداء الوسطاء', entity: 'saleDeal', groupBy: 'brokerId', agg: 'sum', field: 'price', where: { status: 'completed' } },
  ],
  publicForms: [{ key: 'propertyInquiry', entity: 'inquiry', fields: ['name', 'phone', 'email', 'propertyId', 'message'] }],
  publicActions: [
    /** A visitor asks to view a property: creates (or reuses, by phone) a website lead and a `requested` viewing the sales team confirms. */
    { key: 'viewingRequest', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
      const v = validateData({ fields: { name: { type: 'string', required: true }, phone: { type: 'phone', required: true }, email: { type: 'email' } } }, b.visitor, { partial: false });
      if (Object.keys(v.errors).length) ctx.fail(400, 'VALIDATION_ERROR', Object.entries(v.errors).map(([k, m]) => `${k} ${m}`).join('; '));
      const t = ctx.get(String(b.propertyId ?? b.unitId ?? ''));
      if (!t || !['property', 'unit'].includes(t.entityType) || t.data.status !== 'available') ctx.fail(409, 'NOT_AVAILABLE', 'This property is not available for viewing');
      const lead = ctx.find('lead', { phone: v.data.phone }).find((l) => !['won', 'lost'].includes(String(l.data.stage)))
        ?? ctx.createFull('lead', { name: v.data.name, phone: v.data.phone, email: v.data.email, source: 'website', propertyId: t!.entityType === 'property' ? t!.id : undefined });
      const vw = ctx.createFull('viewing', { [t!.entityType === 'property' ? 'propertyId' : 'unitId']: t!.id, leadId: lead.id, date: b.date, startTime: b.startTime || undefined, visitorName: v.data.name, visitorPhone: v.data.phone, notes: b.message || undefined, status: 'requested' });
      notifyTenant(ctx.db, ctx.tenantId, 'viewing', `New viewing request ${vw.code}`, `${v.data.name} — ${String(b.date)}`);
      return { code: vw.code, status: vw.data.status, date: vw.data.date };
    } },
  ],
  employeeModules: { properties: ['read', 'create', 'update'], units: ['read', 'create', 'update'], projects: ['read'], propertyTypes: ['read'], locations: ['read'], brokers: ['read'], clients: ['read', 'create', 'update'],
    leads: ['read', 'create', 'update'], followUps: ['read', 'create', 'update'], viewings: ['read', 'create', 'update'], inquiries: ['read', 'update'], sales: ['read', 'create', 'update'], rentals: ['read', 'create', 'update'], documents: ['read', 'create'] },
};
