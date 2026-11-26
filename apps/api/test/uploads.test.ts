import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, seedPlatform, plans } from '@codela/db';
import { createApp } from '../src/app';
import { employeeAgent, setup, tenantClient } from './_helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from('%PDF-1.7\n%test\n');
const up = (t: { agent: request.Agent; csrf: string }, purpose: string, body: Buffer, name: string, type = 'application/octet-stream') =>
  t.agent.post(`/api/v1/tenant/files?purpose=${purpose}`).set('x-csrf-token', t.csrf).set('x-file-name', encodeURIComponent(name)).set('content-type', type).send(body);

describe('file uploads', () => {
  it('stores a valid image, detects type from bytes, serves it privately and publicly (logo)', async () => {
    const { app } = setup(); const t = await tenantClient(app, 'up1', 'medical');
    const r = await up(t, 'logo', PNG, 'logo.exe', 'application/x-msdownload'); // lying name + MIME: bytes win
    expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ mime: 'image/png', visibility: 'public' }); expect(r.body.data.name).toBe('logo.png');
    const pubRes = await request(app).get(r.body.data.url); expect(pubRes.status).toBe(200); expect(pubRes.headers['content-type']).toContain('image/png'); expect(pubRes.headers['x-content-type-options']).toBe('nosniff');
    const d = await up(t, 'document', PDF, 'a.pdf'); expect(d.body.data.visibility).toBe('private');
    expect((await request(app).get(`/api/v1/public/files/${d.body.data.id}`)).status).toBe(404);   // private files are never public
    expect((await request(app).get(d.body.data.url)).status).toBe(401);                             // and need a session
    expect((await t.agent.get(d.body.data.url)).status).toBe(200);
  });
  it('rejects disguised/oversized/wrong-purpose uploads and writes nothing to disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codela-up-')); const db = createDb(':memory:'); seedPlatform(db);
    const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, uploadDir: dir }); const t = await tenantClient(app, 'up2', 'medical');
    expect((await up(t, 'logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png', 'image/png')).status).toBe(415);
    expect((await up(t, 'document', Buffer.from('<html><script>1</script></html>'), 'x.txt', 'text/plain')).status).toBe(415);
    expect((await up(t, 'logo', PDF, 'x.pdf')).status).toBe(415);
    expect((await up(t, 'avatar', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]), 'big.png')).status).toBe(413);
    expect((await up(t, 'bogus', PNG, 'x.png')).status).toBe(400);
    expect(readdirSync(dir)).toEqual([]);
  });
  it('requires auth + CSRF, and enforces per-purpose permissions (employee cannot upload a logo)', async () => {
    const { app } = setup(); const t = await tenantClient(app, 'up3', 'medical');
    expect((await request(app).post('/api/v1/tenant/files?purpose=avatar').send(PNG)).status).toBe(401);
    expect((await t.agent.post('/api/v1/tenant/files?purpose=avatar').set('content-type', 'application/octet-stream').send(PNG)).status).toBe(403); // no CSRF header
    const e = await employeeAgent(app, t, 'up3');
    expect((await up(e, 'logo', PNG, 'l.png')).status).toBe(403);
    expect((await up(e, 'avatar', PNG, 'me.png')).status).toBe(201);
  });
  it('isolates tenants: another tenant cannot read or delete a file (404, not 403)', async () => {
    const { app } = setup(); const a = await tenantClient(app, 'upa', 'medical'); const b = await tenantClient(app, 'upb', 'medical');
    const f = (await up(a, 'document', PDF, 'secret.pdf')).body.data;
    expect((await b.agent.get(`/api/v1/tenant/files/${f.id}`)).status).toBe(404);
    expect((await b.agent.delete(`/api/v1/tenant/files/${f.id}`).set('x-csrf-token', b.csrf)).status).toBe(404);
    expect((await b.agent.get('/api/v1/tenant/files')).body.data).toEqual([]);
    expect((await a.agent.delete(`/api/v1/tenant/files/${f.id}`).set('x-csrf-token', a.csrf)).status).toBe(200);
    expect((await a.agent.get(`/api/v1/tenant/files/${f.id}`)).status).toBe(404);
  });
  it('enforces the plan storage quota', async () => {
    const { app, db } = setup(); const t = await tenantClient(app, 'upq', 'medical');
    const big = Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]);
    for (const p of db.select().from(plans).all()) db.update(plans).set({ limits: { ...p.limits, storageMb: 5 } }).where(eq(plans.id, p.id)).run();
    expect((await up(t, 'document', big, 'a.pdf')).status).toBe(201);
    const second = await up(t, 'document', big, 'b.pdf'); expect(second.status).toBe(403); expect(second.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});

describe('uploaded logo in the website settings', () => {
  const site = (logoUrl: string) => ({ templateKey: 'classic', brand: { name: 'Logo Clinic', primaryColor: '#0e7490', secondaryColor: '#15803d', logoUrl, description: '', socials: {} }, sections: [{ type: 'hero', enabled: true, content: { title: 'Hi' } }] });
  it('accepts the uploaded file path as logoUrl, but not arbitrary relative paths or http URLs', async () => {
    const { app } = setup(); const t = await tenantClient(app, 'lgo', 'medical');
    const f = (await up(t, 'logo', PNG, 'logo.png')).body.data;
    const put = (u: string) => t.agent.put('/api/v1/tenant/site').set('x-csrf-token', t.csrf).send(site(u));
    expect((await put(f.url)).status).toBe(200);
    expect((await put('/api/v1/tenant/files/anything')).status).toBe(400);
    expect((await put('/etc/passwd')).status).toBe(400);
    expect((await put('http://evil.example/x.png')).status).toBe(400);
  });
});

describe('attachments linked to records', () => {
  const upTo = (t: { agent: request.Agent; csrf: string }, entityType: string, entityId: string, purpose = 'document') =>
    t.agent.post(`/api/v1/tenant/files?purpose=${purpose}&entityType=${entityType}&entityId=${entityId}`).set('x-csrf-token', t.csrf).set('x-file-name', 'scan.pdf').set('content-type', 'application/octet-stream').send(PDF);
  it('attaches to a record of the same tenant, lists by record, and refuses foreign or half-specified links', async () => {
    const { app } = setup(); const a = await tenantClient(app, 'atta', 'medical'); const b = await tenantClient(app, 'attb', 'medical');
    const pa = (await a.create('patient', { name: 'Pat A', phone: '01011112222' })).body.data; const pb = (await b.create('patient', { name: 'Pat B', phone: '01011113333' })).body.data;
    const ok = await upTo(a, 'patient', pa.id, 'medical'); expect(ok.status).toBe(201); expect(ok.body.data).toMatchObject({ entityType: 'patient', entityId: pa.id });
    expect((await upTo(a, 'patient', pb.id)).status).toBe(404);                                  // another tenant's record
    expect((await upTo(a, 'doctor', pa.id)).status).toBe(404);                                   // right id, wrong entity type
    expect((await a.agent.post(`/api/v1/tenant/files?purpose=document&entityId=${pa.id}`).set('x-csrf-token', a.csrf).set('content-type', 'application/octet-stream').send(PDF)).status).toBe(400);
    const list = await a.agent.get(`/api/v1/tenant/files?entityId=${pa.id}`); expect(list.body.data).toHaveLength(1);
    expect((await b.agent.get(`/api/v1/tenant/files?entityId=${pa.id}`)).body.data).toEqual([]);
  });
});
