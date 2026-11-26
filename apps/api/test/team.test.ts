import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

describe('team management', () => {
  it('lists tenant members with roles only (no secrets), isolated per tenant', async () => {
    const a = await tenantClient(ctx.app, 'alpha', 'medical'); const b = await tenantClient(ctx.app, 'beta', 'medical');
    await a.post('/api/v1/tenant/employees', { name: 'Emp One', email: 'one@alpha.test', password: 'Emp-Pass-1234!', role: 'employee' });
    const r = await a.agent.get('/api/v1/tenant/employees'); expect(r.status).toBe(200);
    expect(r.body.data.map((m: { email: string; role: string }) => `${m.email}:${m.role}`).sort()).toEqual(['o@alpha.test:owner', 'one@alpha.test:employee']);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|password_hash/); expect((await b.agent.get('/api/v1/tenant/employees')).body.data).toHaveLength(1);
  });
  it('requires employees.read', async () => {
    const a = await tenantClient(ctx.app, 'alpha', 'medical'); const e = await employeeAgent(ctx.app, a, 'alpha');
    expect((await e.agent.get('/api/v1/tenant/employees')).status).toBe(403); expect((await request(ctx.app).get('/api/v1/tenant/employees')).status).toBe(401);
  });
  it('owner can suspend/reactivate members; cannot touch the owner or other tenants; suspended members lose access', async () => {
    const a = await tenantClient(ctx.app, 'alpha', 'medical'); const b = await tenantClient(ctx.app, 'beta', 'medical');
    const e = await employeeAgent(ctx.app, a, 'alpha'); const list = (await a.agent.get('/api/v1/tenant/employees')).body.data as { id: string; role: string }[];
    const emp = list.find((m) => m.role === 'employee')!; const owner = list.find((m) => m.role === 'owner')!;
    expect((await a.agent.patch(`/api/v1/tenant/employees/${emp.id}`).set('x-csrf-token', a.csrf).send({ status: 'suspended' })).status).toBe(200);
    expect((await e.agent.get('/api/v1/tenant/p-meta')).status).toBe(401);
    expect((await a.agent.patch(`/api/v1/tenant/employees/${emp.id}`).set('x-csrf-token', a.csrf).send({ status: 'active' })).status).toBe(200); expect((await e.agent.get('/api/v1/tenant/notifications')).status).toBe(200);
    expect((await a.agent.patch(`/api/v1/tenant/employees/${owner.id}`).set('x-csrf-token', a.csrf).send({ status: 'suspended' })).status).toBe(409);
    expect((await b.agent.patch(`/api/v1/tenant/employees/${emp.id}`).set('x-csrf-token', b.csrf).send({ status: 'suspended' })).status).toBe(404);
    expect((await a.agent.patch(`/api/v1/tenant/employees/${emp.id}`).set('x-csrf-token', a.csrf).send({ status: 'weird' })).status).toBe(400);
  });
});
