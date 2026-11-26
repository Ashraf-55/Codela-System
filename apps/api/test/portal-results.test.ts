import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { setup, tenantClient } from './_helpers';

const PW = 'Str0ng-Pass!1';
describe('patient portal: lab results and imaging reports', () => {
  it('a patient sees only their own results, and only after the lab / radiology has finished (never a draft)', async () => {
    const db = createDb(':memory:'); seedPlatform(db); const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, rootDomain: 'codela.test', portalEmailVerification: false });
    const o = await tenantClient(app, 'pr-med', 'medical'); const spec = (await o.create('specialty', { name: 'General' })).body.data; const doc = (await o.create('doctor', { name: 'Dr Y', specialtyId: spec.id })).body.data;
    const pat = (await o.create('patient', { name: 'Pat One', email: 'pat@x.com', phone: '01011112222' })).body.data; const other = (await o.create('patient', { name: 'Other', email: 'other@x.com', phone: '01011113333' })).body.data;
    const lab = (await o.create('labRequest', { patientId: pat.id, doctorId: doc.id, test: 'CBC' })).body.data; const labOther = (await o.create('labRequest', { patientId: other.id, doctorId: doc.id, test: 'SECRET-OTHER-TEST' })).body.data;
    const img = (await o.create('imagingRequest', { patientId: pat.id, doctorId: doc.id, modality: 'xray', bodyPart: 'Chest', reportText: 'DRAFT REPORT' })).body.data;
    const agent = request.agent(app); const call = (u: string) => agent.get(`/api/v1/public/portal${u}`).set('Host', 'pr-med.codela.test');
    await agent.post('/api/v1/public/portal/register').set('Host', 'pr-med.codela.test').send({ name: 'Pat One', email: 'pat@x.com', password: PW });
    let my = (await call('/my')).body.data; expect(my.items.labRequest.map((x: { test: string }) => x.test)).toEqual(['CBC']); expect(JSON.stringify(my)).not.toContain('SECRET-OTHER-TEST');
    expect(my.items.labRequest[0].results).toBeUndefined(); expect(my.items.imagingRequest[0].reportText).toBeUndefined(); expect(JSON.stringify(my)).not.toContain('DRAFT REPORT'); // nothing is shown before it is finished

    expect((await o.patch('labRequest', lab.id, { status: 'sample_collected' })).status).toBe(200);
    expect((await o.patch('labRequest', lab.id, { status: 'resulted' })).status).toBe(400); // a result is required
    expect((await o.patch('labRequest', lab.id, { status: 'resulted', results: [{ parameter: 'Hemoglobin', value: '13.5', unit: 'g/dL', range: '12-16' }], resultText: 'Normal' })).status).toBe(200);
    expect((await o.patch('labRequest', labOther.id, { status: 'sample_collected' })).status).toBe(200);
    my = (await call('/my')).body.data; expect(my.items.labRequest[0]).toMatchObject({ status: 'resulted', resultText: 'Normal', results: [{ parameter: 'Hemoglobin', value: '13.5', unit: 'g/dL', range: '12-16' }] });
    expect(my.items.imagingRequest[0].reportText).toBeUndefined();
    for (const [st, extra] of [['scheduled', { scheduledAt: '2030-01-07T10:00:00.000Z' }], ['performed', {}], ['reported', { reportText: 'No acute findings.' }]] as const) expect((await o.patch('imagingRequest', img.id, { status: st, ...extra })).status, st).toBe(200);
    my = (await call('/my')).body.data; expect(my.items.imagingRequest[0]).toMatchObject({ status: 'reported', reportText: 'No acute findings.' }); expect(JSON.stringify(my)).not.toContain('DRAFT REPORT');
  });
  it('the medication catalogue carries batch and expiry for the pharmacist', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'pr-ph', 'medical');
    const m = await o.create('medication', { name: 'Amoxil', sku: 'AMX-1', price: 5000, reorderLevel: 10, batchNo: 'B-77', expiryDate: '2027-03-31' }); expect(m.status).toBe(201); expect(m.body.data.data).toMatchObject({ batchNo: 'B-77', expiryDate: '2027-03-31', stock: 0 });
    expect((await o.create('medication', { name: 'Bad', sku: 'B-1', price: 1, expiryDate: 'soon' })).status).toBe(400);
  });
});
