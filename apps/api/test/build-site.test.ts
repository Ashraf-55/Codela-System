import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

describe('construction: contracts, progress claims, team/services and inspection requests', () => {
  it('claims are cumulative, capped by the active contract, frozen once created and approved in order', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'bld', 'construction');
    const cl = (await o.create('client', { name: 'Owner Co' })).body.data; const pj = (await o.create('project', { name: 'Villa', clientId: cl.id, status: 'active' })).body.data;
    expect((await o.create('contract', { projectId: pj.id, title: 'Main', value: 1_000_000, status: 'active' })).status).toBe(409);        // starts as draft
    const c1 = (await o.create('contract', { projectId: pj.id, title: 'Main', value: 1_000_000, retentionBp: 500 })).body.data; const c2 = (await o.create('contract', { projectId: pj.id, title: 'Alt', value: 5 })).body.data;
    expect((await o.patch('contract', c1.id, { status: 'active' })).status).toBe(200); expect((await o.get('project', pj.id)).body.data.data.contractValue).toBe(1_000_000);
    expect((await o.patch('contract', c2.id, { status: 'active' })).body.error.code).toBe('CONTRACT_EXISTS');                                // one active contract per project
    expect((await o.patch('contract', c1.id, { value: 2_000_000 })).body.error.code).toBe('LOCKED');

    const claim = (cum: number, extra: object = {}) => o.create('progressClaim', { projectId: pj.id, contractId: c1.id, periodTo: '2030-01-31', cumulativeValue: cum, ...extra });
    expect((await claim(2_000_000)).body.error.code).toBe('EXCEEDS_CONTRACT');
    const k1 = (await claim(200_000)).body.data; expect(k1.data).toMatchObject({ status: 'draft', no: 1, previousCumulative: 0, grossAmount: 200_000, retentionAmount: 10_000, netAmount: 190_000 }); // retention defaults from the contract (5%)
    expect((await o.patch('progressClaim', k1.id, { status: 'approved' })).body.error.code).toBe('INVALID_TRANSITION');                        // draft -> submitted first
    expect((await o.patch('progressClaim', k1.id, { cumulativeValue: 999_999 })).status).toBe(200);                                             // amounts are ignored on update
    expect((await o.get('progressClaim', k1.id)).body.data.data.cumulativeValue).toBe(200_000);
    for (const st of ['submitted', 'approved']) expect((await o.patch('progressClaim', k1.id, { status: st })).status).toBe(200);
    expect((await claim(150_000)).body.error.code).toBe('NOT_INCREASING');
    const k2 = (await claim(500_000)).body.data; expect(k2.data).toMatchObject({ no: 2, previousCumulative: 200_000, grossAmount: 300_000, retentionAmount: 15_000, netAmount: 285_000 });
    const k3 = (await claim(400_000, { deductions: 1000 })).body.data; expect(k3.data.netAmount).toBe(200_000 - 10_000 - 1000);                  // drafted from the same position as k2
    for (const st of ['submitted', 'approved']) expect((await o.patch('progressClaim', k2.id, { status: st })).status).toBe(200);
    await o.patch('progressClaim', k3.id, { status: 'submitted' }); expect((await o.patch('progressClaim', k3.id, { status: 'approved' })).body.error.code).toBe('STALE_CLAIM');
    expect((await o.patch('progressClaim', k1.id, { status: 'paid' })).status).toBe(200); expect((await o.get('progressClaim', k1.id)).body.data.data.paidAt).toBeTruthy();
    expect((await o.patch('progressClaim', k1.id, { notes: 'x' })).status).toBe(409);                                                           // paid is final
    expect((await o.kpis()).claimsDue).toBe(285_000);
  });

  it('public site: team and services are public when active; inspection and quote requests share one inbox; before/after images are public', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'bld2', 'construction'); const h = 'bld2.codela.test'; const get = (e: string) => request(app).get(`/api/v1/public/catalog/${e}`).set('Host', h);
    await o.create('teamMember', { name: 'Eng. Ali', title: 'Site engineer', position: 1 }); await o.create('teamMember', { name: 'Hidden', active: false });
    await o.create('service', { name: 'Full finishing', description: 'Turnkey' }); await o.create('service', { name: 'Off', active: false });
    expect((await get('teamMember')).body.data.map((t: { name: string }) => t.name)).toEqual(['Eng. Ali']); expect((await get('service')).body.data.map((t: { name: string }) => t.name)).toEqual(['Full finishing']);
    const cl = (await o.create('client', { name: 'C' })).body.data;
    await o.create('project', { name: 'Flat 5', clientId: cl.id, status: 'completed', showInPortfolio: true, images: [{ url: 'https://x.test/b.jpg', kind: 'before' }, { url: 'https://x.test/a.jpg', kind: 'after' }] });
    expect((await get('project')).body.data[0].images.map((i: { kind: string }) => i.kind)).toEqual(['before', 'after']);
    const post = (k: string, b: object) => request(app).post(`/api/v1/public/forms/${k}`).set('Host', h).send(b);
    expect((await post('inspection', { name: 'Omar', phone: '01011112222', location: 'New Cairo', preferredDate: '2030-03-01' })).status).toBe(201);
    expect((await post('quoteRequest', { name: 'Omar', phone: '01011112222', projectType: 'Finishing', kind: 'inspection' })).status).toBe(201);   // kind cannot be forged
    const rows = (await o.list('quoteRequest')).body.data; expect(rows.map((r: { data: { kind: string } }) => r.data.kind).sort()).toEqual(['inspection', 'quote']);
  });
});
