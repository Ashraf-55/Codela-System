import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

describe('automotive public site: parts search, quote and booking requests', () => {
  it('filters, sorts and pages the parts catalogue on the server; quote and booking land in one inbox told apart by kind', async () => {
    const { app } = setup(); const o = await tenantClient(app, 'autoq', 'automotive'); const other = await tenantClient(app, 'autoq2', 'automotive'); const h = 'autoq.codela.test';
    const mk = (sku: string, name: string, price: number, extra: object = {}) => o.create('sparePart', { sku, name, price, ...extra });
    const filter = (await mk('OF-1', 'Oil filter', 5000, { brand: 'Bosch', compatibility: 'Toyota Corolla 2018' })).body.data;
    await mk('BT-1', 'Battery 60Ah', 250000, { brand: 'Varta', compatibility: 'Hyundai Elantra' }); await mk('BP-1', 'Brake pads', 90000, { brand: 'Bosch', compatibility: 'Toyota Corolla' }); await mk('HID-1', 'Hidden', 100, { active: false });
    const cat = (qs: string) => request(app).get(`/api/v1/public/catalog/sparePart?${qs}`).set('Host', h);
    const byModel = await cat('q=corolla'); expect(byModel.body.data.map((p: { sku: string }) => p.sku).sort()).toEqual(['BP-1', 'OF-1']); expect(byModel.body.meta.total).toBe(2);
    expect((await cat('brand=Varta')).body.data).toHaveLength(1);
    const desc = await cat('sort=price&dir=desc&pageSize=2'); expect(desc.body.data.map((p: { sku: string }) => p.sku)).toEqual(['BT-1', 'BP-1']); expect(desc.body.meta.total).toBe(3); // inactive parts never appear
    expect((await cat('sort=price&dir=desc&pageSize=2&page=2')).body.data.map((p: { sku: string }) => p.sku)).toEqual(['OF-1']);
    expect(JSON.stringify(byModel.body)).not.toMatch(/cost|supplierId|reorderLevel/);

    const post = (key: string, b: object) => request(app).post(`/api/v1/public/forms/${key}`).set('Host', h).send(b);
    expect((await post('quote', { name: 'Omar', phone: '01011112222', plate: 'ABC 123', partId: filter.id, message: 'Price for 2?' })).status).toBe(201);
    expect((await post('booking', { name: 'Omar', phone: '01011112222', plate: 'ABC 123', preferredDate: '2030-01-05', message: 'Oil change', kind: 'quote' })).status).toBe(201); // kind cannot be forged by the visitor
    const foreign = (await other.create('sparePart', { sku: 'X-1', name: 'Foreign', price: 100 })).body.data;
    expect((await post('quote', { name: 'Omar', phone: '01011112222', partId: foreign.id })).status).toBeGreaterThanOrEqual(400); // another tenant's part
    const rows = (await o.list('bookingRequest')).body.data; expect(rows).toHaveLength(2);
    expect(rows.map((r: { data: { kind: string } }) => r.data.kind).sort()).toEqual(['booking', 'quote']);
    expect((await o.list('bookingRequest', '?kind=quote')).body.data).toHaveLength(1);
  });
});
