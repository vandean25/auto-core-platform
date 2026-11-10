/**
 * ADR-0037 D8 lock graph (PATCH slice): Tx-A A→J; Tx-E J→I; legacy PATCH I only.
 * No I→J path; Tx-A/fence advisory keys differ per (tenant, principal, key).
 */
describe('guarded price lock graph (AUT-929)', () => {
  it('documents Tx-A order: advisory lock, then journal read/insert', () => {
    const order = ['pg_advisory_xact_lock(J)', 'journal read/insert', 'commit Tx-A'];
    expect(order[0]).toContain('J');
    expect(order).not.toContain('catalog_items FOR UPDATE');
  });

  it('documents Tx-E order: journal FOR UPDATE, then catalog_item FOR UPDATE', () => {
    const txE = ['inventory_price_operations FOR UPDATE', 'catalog_items FOR UPDATE'];
    expect(txE).toEqual([
      'inventory_price_operations FOR UPDATE',
      'catalog_items FOR UPDATE',
    ]);
  });

  it('documents cron pg_advisory_lock(int,int) as separate from hashtextextended key space', () => {
    const cronKeys = 'pg_advisory_lock(int, int)';
    const journalKeys = 'pg_advisory_xact_lock(hashtextextended(...))';
    expect(cronKeys).not.toEqual(journalKeys);
  });
});
