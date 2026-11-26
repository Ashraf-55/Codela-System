import { describe, it, expect } from 'vitest';
import { validateData, type EntityDef } from '../src/products/framework';

const def: EntityDef = {
  key: 'thing', module: 'things', labelEn: 'Thing', labelAr: 'شيء', titleField: 'name',
  fields: {
    name: { type: 'string', required: true, max: 10 },
    email: { type: 'email' }, phone: { type: 'phone' }, born: { type: 'date' }, at: { type: 'time' },
    qty: { type: 'int', min: 0, max: 100 }, price: { type: 'money' }, flag: { type: 'bool', default: false },
    kind: { type: 'enum', values: ['a', 'b'], default: 'a' }, owner: { type: 'ref', entity: 'person' },
    total: { type: 'money', readonly: true },
    lines: { type: 'lines', fields: { desc: { type: 'string', required: true }, qty: { type: 'int', min: 1 }, unitPrice: { type: 'money' } }, max: 3 },
  },
};
const ok = (input: object, partial = false) => validateData(def, input, { partial });

describe('validateData', () => {
  it('accepts valid data, applies defaults, normalizes', () => {
    const r = ok({ name: 'Box', email: ' A@B.CO ', phone: '٠١٠٠ 123-4567', born: '2020-02-29', at: '09:30', qty: 5, price: 1999 });
    expect(r.errors).toEqual({}); expect(r.data).toMatchObject({ email: 'a@b.co', phone: '01001234567', flag: false, kind: 'a', price: 1999 });
  });
  it('required, max length', () => {
    expect(ok({}).errors.name).toBeDefined(); expect(ok({ name: 'x'.repeat(11) }).errors.name).toBeDefined();
  });
  it('partial update skips required but validates given fields', () => {
    expect(ok({ qty: 3 }, true).errors).toEqual({}); expect(ok({ qty: -1 }, true).errors.qty).toBeDefined();
  });
  it('rejects bad email/phone/date/time/enum/int/money', () => {
    const e = ok({ name: 'x', email: 'nope', phone: 'abc', born: '2021-02-30', at: '25:00', kind: 'z', qty: 1.5, price: 10.5 }).errors;
    for (const k of ['email', 'phone', 'born', 'at', 'kind', 'qty', 'price']) expect(e[k], k).toBeDefined();
  });
  it('money must be integer minor units, never float/negative/string', () => {
    expect(ok({ name: 'x', price: -1 }).errors.price).toBeDefined(); expect(ok({ name: 'x', price: '5' as never }).errors.price).toBeDefined();
  });
  it('ignores readonly and unknown fields (no mass assignment)', () => {
    const r = ok({ name: 'x', total: 999, tenantId: 'evil', __proto__: { a: 1 } });
    expect(r.data.total).toBeUndefined(); expect(r.data.tenantId).toBeUndefined();
  });
  it('ref must be a string id', () => { expect(ok({ name: 'x', owner: 5 as never }).errors.owner).toBeDefined(); expect(ok({ name: 'x', owner: 'abc' }).errors).toEqual({}); });
  it('lines validate each row and max', () => {
    expect(ok({ name: 'x', lines: [{ desc: 'a', qty: 2, unitPrice: 100 }] }).errors).toEqual({});
    expect(ok({ name: 'x', lines: [{ qty: 2 }] }).errors['lines.0.desc']).toBeDefined();
    expect(ok({ name: 'x', lines: [{ desc: 'a', qty: 0 }] }).errors['lines.0.qty']).toBeDefined();
    expect(ok({ name: 'x', lines: Array(4).fill({ desc: 'a', qty: 1 }) }).errors.lines).toBeDefined();
  });
  it('null clears optional fields but not required', () => {
    expect(ok({ email: null }, true).errors).toEqual({}); expect(ok({ name: null }, true).errors.name).toBeDefined();
  });
});
