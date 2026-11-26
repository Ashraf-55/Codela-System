import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const co = (slug = 'alpha') => tenantClient(ctx.app, slug, 'construction');
const host = (slug = 'alpha') => `${slug}.codela.test`;
const today = new Date().toISOString().slice(0, 10);

async function seed(c: TC) {
  const client = (await c.create('client', { name: 'Mr. Owner', phone: '01001234567' })).body.data;
  const sup = (await c.create('supplier', { name: 'Steel Co', phone: '01111111111' })).body.data;
  const mat = (await c.create('material', { sku: 'CEM-50', name: 'Cement bag', unit: 'bag', cost: 9000, supplierId: sup.id })).body.data;
  const proj = (await c.create('project', { name: 'Villa Finishing', clientId: client.id, location: 'New Cairo', startDate: '2030-01-01', endDate: '2030-06-30', status: 'active' })).body.data;
  const worker = (await c.create('worker', { name: 'Mahmoud Mason', trade: 'Mason', dailyRate: 80000 })).body.data;
  return { client, sup, mat, proj, worker };
}
const mats = async (c: TC, id: string) => (await c.get('material', id)).body.data.data.stock as number;
const proj = async (c: TC, id: string) => (await c.get('project', id)).body.data.data;

describe('projects & budgets & expenses', () => {
  it('project computed fields are server-controlled; budget lines roll up; expenses track actual cost and over-budget', async () => {
    const c = await co(); const x = await seed(c);
    expect(x.proj.code).toBe('PJ-0001'); expect(x.proj.data).toMatchObject({ actualCost: 0, budget: 0, progressPct: 0, overBudget: false });
    expect((await c.patch('project', x.proj.id, { actualCost: 5, budget: 5, name: 'Villa Finishing 2' })).body.data.data.actualCost).toBe(0);
    await c.create('budgetLine', { projectId: x.proj.id, category: 'material', amount: 500000 }); await c.create('budgetLine', { projectId: x.proj.id, category: 'labor', amount: 300000 });
    expect((await proj(c, x.proj.id)).budget).toBe(800000);
    await c.create('expense', { projectId: x.proj.id, category: 'material', amount: 450000, date: today, description: 'Bricks' });
    let p = await proj(c, x.proj.id); expect(p.actualCost).toBe(450000); expect(p.overBudget).toBe(false);
    await c.create('expense', { projectId: x.proj.id, category: 'labor', amount: 400000, date: today });
    p = await proj(c, x.proj.id); expect(p.actualCost).toBe(850000); expect(p.overBudget).toBe(true);
    expect((await c.kpis()).overBudgetProjects).toBe(1);
    expect((await c.report('costByCategory')).find((r) => r.key === 'material')!.value).toBe(450000);
    expect((await c.create('expense', { projectId: x.proj.id, category: 'labor', amount: 10.5, date: today })).status).toBe(400);
    expect((await c.del('expense', (await c.list('expense')).body.data[0].id)).status).toBe(405);
  });
  it('closed projects reject new costs; dates validated', async () => {
    const c = await co(); const x = await seed(c);
    expect((await c.create('project', { name: 'Bad', clientId: x.client.id, startDate: '2030-05-01', endDate: '2030-01-01' })).status).toBe(400);
    await c.patch('project', x.proj.id, { status: 'completed' });
    expect((await c.create('expense', { projectId: x.proj.id, category: 'other', amount: 1000, date: today })).body.error.code).toBe('PROJECT_CLOSED');
  });
  it('tasks drive progress percentage', async () => {
    const c = await co(); const x = await seed(c);
    const ms = (await c.create('milestone', { projectId: x.proj.id, title: 'Foundation', dueDate: '2030-02-01' })).body.data;
    const t1 = (await c.create('task', { projectId: x.proj.id, milestoneId: ms.id, title: 'Dig' })).body.data; const t2 = (await c.create('task', { projectId: x.proj.id, title: 'Pour concrete' })).body.data; await c.create('task', { projectId: x.proj.id, title: 'Cure' });
    await c.patch('task', t1.id, { status: 'done' }); expect((await proj(c, x.proj.id)).progressPct).toBe(33);
    await c.patch('task', t2.id, { status: 'done' }); expect((await proj(c, x.proj.id)).progressPct).toBe(66);
    expect((await c.create('task', { projectId: x.proj.id, assigneeId: x.sup.id, title: 'Bad assignee' })).body.error.code).toBe('REFERENCE_NOT_FOUND');
  });
});

describe('quotations', () => {
  const q = (x: Awaited<ReturnType<typeof seed>>, over: object = {}) => ({ clientId: x.client.id, title: 'Apartment finishing', discount: 100000, taxBp: 1400, validUntil: '2030-12-31',
    lines: [{ desc: 'Paint', qty: 100, unit: 'm2', unitPrice: 15000 }, { desc: 'Tiles', qty: 50, unit: 'm2', unitPrice: 40000 }], ...over });
  it('integer totals; lines lock after sending; acceptance creates the project; terminal states immutable', async () => {
    const c = await co(); const x = await seed(c);
    const r = await c.create('quotation', q(x, { total: 1 })); expect(r.status).toBe(201); const d = r.body.data.data; expect(r.body.data.code).toBe('QT-0001');
    expect(d.subtotal).toBe(3500000); expect(d.tax).toBe(476000); expect(d.total).toBe(3876000); expect(d.status).toBe('draft');
    expect((await c.create('quotation', q(x, { discount: 99999999 }))).status).toBe(400);
    const id = r.body.data.id;
    expect((await c.patch('quotation', id, { discount: 0 })).body.data.data.total).toBe(3500000 + 490000);
    expect((await c.patch('quotation', id, { status: 'accepted' })).body.error.code).toBe('INVALID_TRANSITION');
    await c.patch('quotation', id, { status: 'sent' });
    expect((await c.patch('quotation', id, { discount: 5 })).body.error.code).toBe('IMMUTABLE');
    const acc = await c.patch('quotation', id, { status: 'accepted' }); expect(acc.status).toBe(200);
    const projId = acc.body.data.data.projectId; expect(projId).toBeTruthy();
    const p = await proj(c, projId); expect(p).toMatchObject({ name: 'Apartment finishing', clientId: x.client.id, status: 'planning', contractValue: 3990000 });
    expect((await c.patch('quotation', id, { status: 'rejected' })).body.error.code).toBe('IMMUTABLE');
    expect((await c.del('project', projId)).body.error.code).toBe('IN_USE');
  });
});

describe('materials & purchasing', () => {
  it('stock ledger: issue to a project requires the project and books a material expense; no negative stock', async () => {
    const c = await co(); const x = await seed(c);
    await c.create('materialMovement', { materialId: x.mat.id, type: 'in', qty: 100, reason: 'opening' });
    expect((await c.create('materialMovement', { materialId: x.mat.id, type: 'out', qty: 10 })).status).toBe(400);
    expect((await c.create('materialMovement', { materialId: x.mat.id, type: 'out', qty: 10, projectId: x.proj.id })).status).toBe(201);
    expect(await mats(c, x.mat.id)).toBe(90); expect((await proj(c, x.proj.id)).actualCost).toBe(90000);
    const e = (await c.list('expense')).body.data[0]; expect(e.data).toMatchObject({ category: 'material', amount: 90000, source: 'material' });
    expect((await c.create('materialMovement', { materialId: x.mat.id, type: 'out', qty: 91, projectId: x.proj.id })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await c.create('materialMovement', { materialId: x.mat.id, type: 'return', qty: 5, projectId: x.proj.id })).status).toBe(201); expect(await mats(c, x.mat.id)).toBe(95);
    expect((await c.del('supplier', x.sup.id)).body.error.code).toBe('IN_USE');
  });
  it('purchase orders: totals, lifecycle, receiving adds stock and books the project cost', async () => {
    const c = await co(); const x = await seed(c);
    const po = (await c.create('purchaseOrder', { supplierId: x.sup.id, projectId: x.proj.id, lines: [{ materialId: x.mat.id, qty: 20, unitCost: 8500 }], total: 1 })).body.data;
    expect(po.code).toBe('PO-0001'); expect(po.data.total).toBe(170000); expect(po.data.status).toBe('draft');
    expect((await c.patch('purchaseOrder', po.id, { status: 'received' })).body.error.code).toBe('INVALID_TRANSITION');
    await c.patch('purchaseOrder', po.id, { status: 'ordered' }); expect((await c.patch('purchaseOrder', po.id, { lines: [{ materialId: x.mat.id, qty: 1, unitCost: 1 }] })).body.error.code).toBe('IMMUTABLE');
    expect(await mats(c, x.mat.id)).toBe(0);
    expect((await c.patch('purchaseOrder', po.id, { status: 'received' })).status).toBe(200);
    expect(await mats(c, x.mat.id)).toBe(20); expect((await proj(c, x.proj.id)).actualCost).toBe(170000);
    expect((await c.patch('purchaseOrder', po.id, { status: 'cancelled' })).body.error.code).toBe('IMMUTABLE');
  });
});

describe('workers', () => {
  it('assignments cannot overlap for a worker; work logs book labour cost', async () => {
    const c = await co(); const x = await seed(c);
    const p2 = (await c.create('project', { name: 'Shop fit-out', clientId: x.client.id, status: 'active' })).body.data;
    expect((await c.create('assignment', { workerId: x.worker.id, projectId: x.proj.id, startDate: '2030-01-10', endDate: '2030-01-20', role: 'Lead' })).status).toBe(201);
    expect((await c.create('assignment', { workerId: x.worker.id, projectId: p2.id, startDate: '2030-01-15', endDate: '2030-01-25' })).body.error.code).toBe('WORKER_BUSY');
    expect((await c.create('assignment', { workerId: x.worker.id, projectId: p2.id, startDate: '2030-01-21', endDate: '2030-01-25' })).status).toBe(201);
    expect((await c.create('assignment', { workerId: x.worker.id, projectId: p2.id, startDate: '2030-02-05', endDate: '2030-02-01' })).status).toBe(400);
    const log = await c.create('workLog', { workerId: x.worker.id, projectId: x.proj.id, date: today, hours: 4 }); expect(log.status).toBe(201); expect(log.body.data.data.cost).toBe(40000);
    expect((await proj(c, x.proj.id)).actualCost).toBe(40000);
    expect((await c.create('workLog', { workerId: x.worker.id, projectId: x.proj.id, date: today, hours: 25 })).status).toBe(400);
    expect((await c.create('workLog', { workerId: x.worker.id, projectId: x.proj.id, date: today, hours: 2 })).status).toBe(409); // one log per worker per day
    expect((await c.list('expense')).body.data[0].data).toMatchObject({ category: 'labor', source: 'labor', amount: 40000 });
  });
});

describe('invoicing', () => {
  it('invoice totals, issue, payments (no overpay), immutability, revenue by project', async () => {
    const c = await co(); const x = await seed(c);
    const inv = (await c.create('invoice', { clientId: x.client.id, projectId: x.proj.id, lines: [{ desc: 'Milestone 1', qty: 1, unitPrice: 1000000 }], discount: 0, taxBp: 1400 })).body.data;
    expect(inv.data).toMatchObject({ subtotal: 1000000, tax: 140000, total: 1140000, paidAmount: 0, status: 'draft' }); expect(inv.code).toBe('INV-0001');
    expect((await c.create('payment', { invoiceId: inv.id, amount: 1, method: 'cash' })).body.error.code).toBe('INVOICE_NOT_PAYABLE');
    await c.patch('invoice', inv.id, { status: 'issued' });
    expect((await c.create('payment', { invoiceId: inv.id, amount: 1140001, method: 'transfer' })).body.error.code).toBe('OVERPAYMENT');
    await c.create('payment', { invoiceId: inv.id, amount: 400000, method: 'transfer' }); expect((await c.get('invoice', inv.id)).body.data.data.status).toBe('partially_paid');
    await c.create('payment', { invoiceId: inv.id, amount: 740000, method: 'cash' }); expect((await c.get('invoice', inv.id)).body.data.data.status).toBe('paid');
    expect((await c.patch('invoice', inv.id, { discount: 1 })).body.error.code).toBe('IMMUTABLE');
    expect((await c.report('revenueByProject'))[0]).toEqual({ key: x.proj.id, value: 1140000 }); expect((await c.kpis()).revenueMonth).toBe(1140000);
  });
});

describe('public website & access', () => {
  it('portfolio shows completed showcased projects only; quote requests and inquiries are tenant-scoped', async () => {
    const c = await co(); const x = await seed(c); const o = await co('beta');
    await c.patch('project', x.proj.id, { status: 'completed', showInPortfolio: true, description: 'Luxury finish', images: [{ url: 'https://cdn.x.com/a.jpg' }] });
    await c.create('project', { name: 'Secret job', clientId: x.client.id, status: 'completed', showInPortfolio: false });
    const get = (p: string, h = host()) => request(ctx.app).get(`/api/v1/public/catalog/${p}`).set('Host', h);
    const r = await get('project'); expect(r.body.data.map((p: { name: string }) => p.name)).toEqual(['Villa Finishing']); expect(JSON.stringify(r.body)).not.toMatch(/budget|actualCost|clientId|tenantId|contractValue/);
    expect((await get('quotation')).status).toBe(404);
    const f = await request(ctx.app).post('/api/v1/public/forms/quoteRequest').set('Host', host()).send({ name: 'Visitor', phone: '٠١٠٢٢٢٢٣٣٣٣', projectType: 'villa', location: 'Cairo', message: 'Need a quote' });
    expect(f.status).toBe(201); expect((await c.list('quoteRequest')).body.meta.total).toBe(1); expect((await o.list('quoteRequest')).body.meta.total).toBe(0);
    expect((await request(ctx.app).post('/api/v1/public/forms/quoteRequest').set('Host', host()).send({ name: 'V' })).status).toBe(400);
  });
  it('employees see projects/tasks but not budgets, quotations pricing admin, payments or purchasing; global search works', async () => {
    const c = await co(); const x = await seed(c); const e = await employeeAgent(ctx.app, c, 'alpha');
    expect((await e.agent.get('/api/v1/tenant/p/project')).status).toBe(200); for (const ent of ['budgetLine', 'purchaseOrder', 'payment']) expect((await e.agent.get(`/api/v1/tenant/p/${ent}`)).status).toBe(403);
    expect((await e.agent.post('/api/v1/tenant/p/task').set('x-csrf-token', e.csrf).send({ projectId: x.proj.id, title: 'Site check' })).status).toBe(201);
    const t = async (q: string) => (await c.search(q)).map((s) => s.entityType);
    expect(await t('villa')).toContain('project'); expect(await t('mahmoud')).toContain('worker'); expect(await t('CEM-50')).toContain('material'); expect(await t('steel')).toContain('supplier'); expect(await t('PJ-0001')).toContain('project');
    expect((await c.kpis()).activeProjects).toBe(1);
  });
});
