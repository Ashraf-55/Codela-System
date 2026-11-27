import { describe, expect, it } from 'vitest';
import { createBridge } from '../src/inproc';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';

// scripts/start-all.mjs serves the API in-process through light-my-request (Hostinger refuses loopback connections).
// These requests go through exactly that path, including the streamed video upload that stops early on a bad file.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8), Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'.repeat(40))]);
function build() { const db = createDb(':memory:'); seedPlatform(db);
  return createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', portalEmailVerification: false, uploadDir: mkdtempSync(path.join(tmpdir(), 'codela-inj-')) }); }

describe('in-process bridge (light-my-request) used by start-all', () => {
  it('register, authenticated CRUD, and streamed video upload: a disguised file gets 415, a real MP4 is stored', async () => {
    const bridge = createBridge(build() as never);
    const call = async (o: { method: string; url: string; headers?: Record<string, string>; payload?: object | Buffer }) => {
      const isJson = o.payload && !Buffer.isBuffer(o.payload);
      const r = await bridge({ method: o.method, url: o.url, headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) }, payload: isJson ? JSON.stringify(o.payload) : (o.payload as Buffer | undefined) });
      const body = r.body.toString(); const setCookie = r.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v);
      return { statusCode: r.status, body, json: () => JSON.parse(body), headers: { 'set-cookie': setCookie } };
    };
    const reg = await call({ method: 'POST', url: '/api/v1/auth/register-business', payload: { businessName: 'Biz inj1', slug: 'inj1', productSlug: 'learning', name: 'Owner', email: 'o@inj1.test', password: 'Str0ng-Pass!1' } });
    expect(reg.statusCode).toBe(201);
    const cookie = ([] as string[]).concat(reg.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
    const h = { cookie, 'x-csrf-token': reg.json().data.csrfToken };
    const mk = async (entity: string, body: object) => { const r = await call({ method: 'POST', url: `/api/v1/tenant/p/${entity}`, headers: h, payload: body }); expect(r.statusCode, r.body).toBe(201); return r.json().data; };
    const ins = await mk('instructor', { name: 'Dr X' }); const c = await mk('course', { title: 'C', instructorId: ins.id, price: 5000 });
    const lesson = await mk('lesson', { courseId: c.id, title: 'Video', position: 1, kind: 'video' });
    const up = (body: Buffer) => call({ method: 'POST', url: `/api/v1/tenant/files/video?entityId=${lesson.id}`, headers: { ...h, 'content-type': 'application/octet-stream', 'x-file-name': 'v.mp4' }, payload: body });
    const bad = await up(Buffer.from('<html>not a video</html>'.repeat(10)));
    expect(bad.statusCode, bad.body).toBe(415); expect(bad.json().error.message).toMatch(/MP4|WebM/);
    const good = await up(MP4); expect(good.statusCode, good.body).toBe(201);
  });
});
