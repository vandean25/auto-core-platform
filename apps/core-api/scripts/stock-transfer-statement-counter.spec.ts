import { stockTransferTransactionStatements } from '../test/helpers/stock-transfer-statement-counter.js';

const transferClient = { name: 'transfer connection' };
const otherClient = { name: 'other connection' };
const on = (connection: object) => (sql: string) => ({ sql, connection });
const transfer = on(transferClient);
const other = on(otherClient);

describe('stockTransferTransactionStatements', () => {
  // Regression: the pg spy is process-wide, so another suite's transaction that BEGINs first and
  // interleaves with the transfer transaction was counted (S1 approve: expected 15, received 70).
  it('counts only the transfer connection when another connection interleaves its transaction', () => {
    const captured = [
      other('BEGIN'),
      transfer('BEGIN'),
      other('UPDATE "public"."inventory_price_operations" SET state = $1'),
      transfer('UPDATE "public"."stock_transfer_lines" SET approved_qty = $1'),
      other('SELECT "public"."sites"."id" FROM "public"."sites"'),
      transfer('UPDATE "public"."stock_transfers" SET status = $1'),
      other('COMMIT'),
      transfer('COMMIT'),
    ];

    expect(stockTransferTransactionStatements(captured)).toEqual([
      'BEGIN',
      'UPDATE "public"."stock_transfer_lines" SET approved_qty = $1',
      'UPDATE "public"."stock_transfers" SET status = $1',
      'COMMIT',
    ]);
  });

  // Regression: an unrelated transaction on the same pooled connection, committed before the
  // transfer transaction began, must not be picked as the measured window.
  it('skips an earlier transaction on the same connection that touches no stock_transfer table', () => {
    const captured = [
      transfer('BEGIN'),
      transfer('INSERT INTO "public"."audit_logs" VALUES ($1)'),
      transfer('COMMIT'),
      transfer('BEGIN'),
      transfer('UPDATE "public"."stock_transfers" SET status = $1'),
      transfer('COMMIT'),
    ];

    expect(stockTransferTransactionStatements(captured)).toEqual([
      'BEGIN',
      'UPDATE "public"."stock_transfers" SET status = $1',
      'COMMIT',
    ]);
  });

  it('leaves out the auth reads before BEGIN and the realtime recipient read after COMMIT', () => {
    const captured = [
      transfer(
        'SELECT "public"."tenant_members"."id" FROM "public"."tenant_members"',
      ),
      transfer('BEGIN'),
      transfer(
        'SELECT "public"."stock_transfers"."id" FROM "public"."stock_transfers"',
      ),
      transfer('COMMIT'),
      transfer(
        'SELECT "public"."site_memberships"."site_id" FROM "public"."site_memberships"',
      ),
    ];

    expect(stockTransferTransactionStatements(captured)).toEqual([
      'BEGIN',
      'SELECT "public"."stock_transfers"."id" FROM "public"."stock_transfers"',
      'COMMIT',
    ]);
  });

  it('fails loudly when no stock_transfer transaction committed', () => {
    const captured = [
      transfer('BEGIN'),
      transfer('UPDATE "public"."stock_transfers" SET status = $1'),
      transfer('ROLLBACK'),
    ];

    expect(() => stockTransferTransactionStatements(captured)).toThrow(
      'No committed stock_transfer transaction',
    );
  });
});
