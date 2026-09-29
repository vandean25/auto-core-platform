import { hashInvoiceSnapshot } from './invoice-snapshot-hash.js';

describe('canonical invoice snapshot hash', () => {
  it('is stable across object property order', () => {
    expect(hashInvoiceSnapshot({ a: 1, b: { x: true, y: 'text' } })).toBe(
      hashInvoiceSnapshot({ b: { y: 'text', x: true }, a: 1 }),
    );
  });

  it('changes when array order changes', () => {
    expect(hashInvoiceSnapshot({ items: ['first', 'second'] })).not.toBe(
      hashInvoiceSnapshot({ items: ['second', 'first'] }),
    );
  });

  it('survives a JSON round trip', () => {
    const snapshot = { total: 120.5, seller: { name: 'ACP' }, items: [1, 2] };
    expect(hashInvoiceSnapshot(snapshot)).toBe(
      hashInvoiceSnapshot(JSON.parse(JSON.stringify(snapshot))),
    );
  });
});
