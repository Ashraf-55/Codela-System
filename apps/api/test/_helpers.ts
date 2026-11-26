import request from 'supertest';
import { expect } from 'vitest';
import { createDb, seedPlatform } from '@codela/db';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app';

export function setup() {
  const db = createDb(':memory:'); seedPlatform(db);
  const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', uploadDir: mkdtempSync(path.join(tmpdir(), 'codela-up-')) });
  return { db, app };
}
export async function tenantClient(app: ReturnType<typeof createApp>, slug: string, productSlug: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/v1/auth/register-business').send({ businessName: `Biz ${slug}`, slug, productSlug, name: 'Owner', email: `o@${slug}.test`, password: 'Str0ng-Pass!1' });
  expect(r.status).toBe(201);
  const csrf = r.body.data.csrfToken as string; const base = '/api/v1/tenant/p';
  const w = (m: 'post' | 'patch' | 'delete', u: string, b?: object) => agent[m](u).set('x-csrf-token', csrf).send(b ?? {});
  return { agent, csrf, tenantId: r.body.data.tenant.id as string,
    list: (e: string, qs = '') => agent.get(`${base}/${e}${qs}`), get: (e: string, id: string) => agent.get(`${base}/${e}/${id}`),
    create: (e: string, b: object) => w('post', `${base}/${e}`, b), patch: (e: string, id: string, b: object) => w('patch', `${base}/${e}/${id}`, b), del: (e: string, id: string) => w('delete', `${base}/${e}/${id}`),
    post: (u: string, b?: object) => w('post', u, b), kpis: async () => (await agent.get('/api/v1/tenant/dashboard')).body.data.kpis as Record<string, number>,
    report: async (k: string) => (await agent.get(`/api/v1/tenant/reports/${k}`)).body.data as { key: string; value: number }[],
    search: async (q: string) => (await agent.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).body.data as { entityType: string; title: string }[] };
}
export type TC = Awaited<ReturnType<typeof tenantClient>>;
export async function employeeAgent(app: ReturnType<typeof createApp>, owner: TC, slug: string) {
  await owner.post('/api/v1/tenant/employees', { name: 'Emp', email: `emp@${slug}.test`, password: 'Emp-Pass-1234!', role: 'employee' });
  const agent = request.agent(app); const l = await agent.post('/api/v1/auth/login').send({ email: `emp@${slug}.test`, password: 'Emp-Pass-1234!' });
  return { agent, csrf: l.body.data.csrfToken as string };
}
