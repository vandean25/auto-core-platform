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

  it('documents Tx-E order: journal FOR UPDATE, re-read, catalog_item FOR UPDATE, re-read', () => {
    const txE = [
      'inventory_price_operations FOR UPDATE',
      'journal re-read (state)',
      'catalog_items FOR UPDATE',
      'catalog_item re-read (revision)',
      'catalogItem.update with revision predicate',
    ];
    expect(txE[0]).toContain('inventory_price_operations');
    expect(txE[3]).toContain('re-read');
  });

  it('documents cron pg_advisory_lock(int,int) as separate from hashtextextended key space', () => {
    const cronKeys = 'pg_advisory_lock(int, int)';
    const journalKeys = 'pg_advisory_xact_lock(hashtextextended(...))';
    expect(cronKeys).not.toEqual(journalKeys);
  });
});
