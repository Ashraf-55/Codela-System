import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

const PRODUCTS = ['medical', 'booking', 'ecommerce', 'restaurant', 'fleet', 'realestate', 'automotive', 'construction', 'learning', 'business'];

async function managerAgent(slug: string, product: string) {
  const owner = await tenantClient(ctx.app, slug, product);
  const email = `mgr@${slug}.test`;
  expect((await owner.post('/api/v1/tenant/employees', { name: 'Mgr', email, password: 'Mgr-Pass-1234!', role: 'manager' })).status).toBe(201);
  const agent = request.agent(ctx.app);
  const l = await agent.post('/api/v1/auth/login').send({ email, password: 'Mgr-Pass-1234!' });
  expect(l.status).toBe(200);
  return { owner, agent, csrf: l.body.data.csrfToken as string };
}

describe('manager must not hold owner-only employees.manage in any product', () => {
  for (const product of PRODUCTS) {
    it(`${product}: manager cannot create or suspend staff accounts`, async () => {
      const slug = `t-${product}`;
      const m = await managerAgent(slug, product);
      const create = await m.agent.post('/api/v1/tenant/employees').set('x-csrf-token', m.csrf)
        .send({ name: 'Backdoor', email: `bd@${slug}.test`, password: 'Back-Pass-1234!', role: 'manager' });
      expect(create.status).toBe(403);
      const list = (await m.owner.agent.get('/api/v1/tenant/employees')).body.data as { id: string; role: string }[];
      const other = list.find((x) => x.role === 'manager')!;
      const patch = await m.agent.patch(`/api/v1/tenant/employees/${other.id}`).set('x-csrf-token', m.csrf).send({ status: 'suspended' });
      expect(patch.status).toBe(403);
    });
  }
});
