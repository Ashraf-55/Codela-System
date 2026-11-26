import { describe, expect, it } from 'vitest';
import { employeeAgent, setup, tenantClient } from './_helpers';

describe('Phase 6 verification: Estate lead performance + Med visits (medicalRecord)', () => {
  it('Estate: lead performance reports count real leads by source and broker, with won / lost outcomes, and stay inside the tenant', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'lpe1', 'realestate'); const other = await tenantClient(app, 'lpe2', 'realestate');
    const b1 = (await o.create('broker', { name: 'Hossam' })).body.data, b2 = (await o.create('broker', { name: 'Mona' })).body.data;
    const mk = async (name: string, source: string, brokerId: string | undefined, stage?: string) => { const l = (await o.create('lead', { name, source, brokerId })).body.data; if (stage) expect((await o.patch('lead', l.id, { stage })).status).toBe(200); return l; };
    await mk('A', 'website', b1.id, 'won'); await mk('B', 'website', b1.id, 'lost'); await mk('C', 'referral', b1.id); await mk('D', 'website', b2.id, 'won'); await mk('E', 'call', undefined);
    await other.create('lead', { name: 'Other tenant', source: 'website' });
    const rep = async (k: string) => Object.fromEntries((await o.report(k)).map((x) => [x.key, x.value]));
    expect(await rep('leadsBySource')).toEqual({ website: 3, referral: 1, call: 1 });
    expect(await rep('leadsWonBySource')).toEqual({ website: 2 }); expect(await rep('leadsLostBySource')).toEqual({ website: 1 });
    expect(await rep('leadsByBroker')).toEqual({ [b1.id]: 3, [b2.id]: 1, unspecified: 1 });
    expect(await rep('leadsWonByBroker')).toEqual({ [b1.id]: 1, [b2.id]: 1 }); expect(await rep('leadsLostByBroker')).toEqual({ [b1.id]: 1 });
    expect((await other.report('leadsBySource')).reduce((a, x) => a + Number(x.value), 0)).toBe(1);
    const emp = await employeeAgent(app, o, 'lpe1'); expect([200, 403]).toContain((await emp.agent.get('/api/v1/tenant/reports/leadsBySource')).status);
  });

  it('Med: a visit is a medicalRecord linked to patient + doctor (+ appointment): required links, history order, filters, no cross-tenant links, restricted to staff with records access', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'mv1', 'medical'); const x = await tenantClient(app, 'mv2', 'medical');
    const pat = (await o.create('patient', { name: 'Layla', phone: '01012345678' })).body.data; const doc = (await o.create('doctor', { name: 'Dr Kareem', consultationFee: 30000 })).body.data;
    const foreignDoc = (await x.create('doctor', { name: 'Dr Foreign' })).body.data;
    expect((await o.create('medicalRecord', { doctorId: doc.id, visitDate: '2026-01-10', complaint: 'x' })).status).toBe(400);                         // patient required
    expect((await o.create('medicalRecord', { patientId: pat.id, doctorId: doc.id, complaint: 'x' })).status).toBe(400);                              // visit date required
    expect((await o.create('medicalRecord', { patientId: pat.id, doctorId: foreignDoc.id, visitDate: '2026-01-10', complaint: 'x' })).status).toBeGreaterThanOrEqual(400); // another clinic's doctor
    await o.create('medicalRecord', { patientId: pat.id, doctorId: doc.id, visitDate: '2026-01-10', complaint: 'Cough', diagnosis: 'Bronchitis', treatment: 'Rest' });
    await o.create('medicalRecord', { patientId: pat.id, doctorId: doc.id, visitDate: '2026-03-02', complaint: 'Follow-up', notes: 'Better' });
    const list = (await o.list('medicalRecord', `?patientId=${pat.id}`)).body.data as { data: { visitDate: string } }[];
    expect(list.map((r) => r.data.visitDate.slice(0, 10))).toEqual(['2026-03-02', '2026-01-10']);                                                 // newest visit first
    expect((await o.list('medicalRecord', `?q=bronchitis`)).body.meta.total).toBe(1);
    expect((await x.list('medicalRecord')).body.meta.total).toBe(0);
    const emp = await employeeAgent(app, o, 'mv1'); expect((await emp.agent.get('/api/v1/tenant/p/medicalRecord')).status).toBe(403);                // front-desk staff cannot read clinical records
  });
});
