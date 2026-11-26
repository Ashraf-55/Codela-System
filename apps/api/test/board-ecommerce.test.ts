import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../src/products/registry';
import { ORDER_NEXT } from '../src/products/defs/ecommerce';
import { BOARDS } from '../../web/src/lib/boards';

/** Guards the merchant's order board: it must never offer a move the API would reject (it once offered shipped -> returned). */
describe('ecommerce order board matches the order rules', () => {
  const cfg = BOARDS.ecommerce;
  const def = PRODUCTS.ecommerce.entities.find((e) => e.key === cfg.entity)!;

  it('points at the real order entity and its status values', () => {
    expect(cfg.entity).toBe('order');
    const values = def.fields.status.values ?? [];
    for (const col of cfg.columns) { expect(values).toContain(col.status); for (const n of col.next) expect(values).toContain(n); }
  });

  it('only offers transitions the API allows', () => {
    for (const col of cfg.columns) for (const n of col.next) expect(ORDER_NEXT[col.status] ?? [], `${col.status} -> ${n}`).toContain(n);
  });

  it('the shipping step is a legal transition and uses editable fields', () => {
    expect(cfg.shipping).toBeTruthy();
    expect(ORDER_NEXT[cfg.shipping!.from]).toContain(cfg.shipping!.to);
    expect(def.fields.carrier).toBeTruthy(); expect(def.fields.trackingNumber).toBeTruthy();
  });

  it('record-payment moves unpaid -> paid, the only payment change the API accepts', () => {
    const pay = cfg.payable!; const values = def.fields[pay.field].values ?? [];
    expect(pay).toMatchObject({ field: 'paymentStatus', from: 'unpaid', to: 'paid' });
    expect(values).toContain(pay.from); expect(values).toContain(pay.to);
  });
});
