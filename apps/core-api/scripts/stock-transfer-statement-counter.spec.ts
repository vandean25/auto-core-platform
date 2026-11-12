import { jest } from '@jest/globals';
import { Client } from 'pg';
import { collectDbStatements } from '../test/helpers/db-statement-counter.js';
import {
  countStockTransferActionStatements,
  stockTransferTransactionStatements,
} from '../test/helpers/stock-transfer-statement-counter.js';

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

  // Regression: a transfer transaction rolled back by a retry (serialization / P2002) must not
  // swallow the committed retry on the same connection.
  it('counts the committed retry, not the rolled-back attempt before it', () => {
    const captured = [
      transfer('BEGIN'),
      transfer('UPDATE "public"."stock_transfers" SET status = $1'),
      transfer('ROLLBACK'),
      transfer('BEGIN'),
      transfer('UPDATE "public"."stock_transfer_lines" SET shipped_qty = $1'),
      transfer('COMMIT'),
    ];

    expect(stockTransferTransactionStatements(captured)).toEqual([
      'BEGIN',
      'UPDATE "public"."stock_transfer_lines" SET shipped_qty = $1',
      'COMMIT',
    ]);
  });

  // Regression: the old denylist only knew some tables, so a stock_transfer read on another
  // connection (e.g. the receive idempotency replay lookup) leaked into the window.
  it('ignores stock_transfer reads that another connection sends outside a transaction', () => {
    const captured = [
      transfer('BEGIN'),
      other(
        'SELECT "public"."stock_transfer_commands"."id" FROM "public"."stock_transfer_commands"',
      ),
      transfer('UPDATE "public"."stock_transfers" SET status = $1'),
      transfer('COMMIT'),
    ];

    expect(stockTransferTransactionStatements(captured)).toEqual([
      'BEGIN',
      'UPDATE "public"."stock_transfers" SET status = $1',
      'COMMIT',
    ]);
  });

  // Regression: the old window started at the first BEGIN anywhere, so a transaction another
  // connection began first and never committed pulled its own statements into the count.
  it('is not held up by a transaction another connection never commits', () => {
    const captured = [
      other('BEGIN'),
      other('SELECT pg_advisory_xact_lock($1)'),
      transfer('BEGIN'),
      transfer('UPDATE "public"."stock_transfers" SET status = $1'),
      transfer('COMMIT'),
      other('SELECT "public"."sites"."id" FROM "public"."sites"'),
    ];

    expect(stockTransferTransactionStatements(captured)).toEqual([
      'BEGIN',
      'UPDATE "public"."stock_transfers" SET status = $1',
      'COMMIT',
    ]);
  });
});

describe('statement capture through the pg Client spy', () => {
  beforeEach(() => {
    jest
      .spyOn(Client.prototype, 'query')
      .mockImplementation((() => Promise.resolve({ rows: [] })) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Regression: without the call context the counter cannot tell connections apart; Prisma's pg
  // adapter sends config objects ({ text }), plain strings come from pg itself.
  it('tags every statement with the Client that sent it, for string and config-object SQL', async () => {
    const transferConnection = new Client();
    const otherConnection = new Client();

    const captured = await collectDbStatements(async () => {
      await transferConnection.query('BEGIN');
      await otherConnection.query({ text: 'SELECT 1' });
    });

    expect(
      captured.map(({ sql, connection }) => [
        sql,
        connection === transferConnection
          ? 'transfer'
          : connection === otherConnection
            ? 'other'
            : 'unknown',
      ]),
    ).toEqual([
      ['BEGIN', 'transfer'],
      ['SELECT 1', 'other'],
    ]);
  });

  // Regression (S1 approve: expected 15, received 70): end to end through the spy, an interleaved
  // transaction on a second Client must not change the count.
  it('counts only the transfer Client when a second Client interleaves its transaction', async () => {
    const transferConnection = new Client();
    const otherConnection = new Client();

    const count = await countStockTransferActionStatements(async () => {
      await otherConnection.query('BEGIN');
      await transferConnection.query('BEGIN');
      await otherConnection.query(
        'INSERT INTO "public"."audit_logs" VALUES ($1)',
      );
      await transferConnection.query({
        text: 'UPDATE "public"."stock_transfers" SET status = $1',
      });
      await otherConnection.query('COMMIT');
      await transferConnection.query('COMMIT');
    });

    expect(count).toBe(3);
  });
});
