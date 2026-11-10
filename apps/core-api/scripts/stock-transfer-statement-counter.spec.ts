import {
  appendResponseTailStatements,
  indexOfFirstBegin,
  isConcurrentSuiteNoiseStatement,
  isStockTransferResponseTailStatement,
  isStockTransferTransactionBegin,
  isStockTransferTransactionCommit,
  stockTransferHandlerStatements,
  statementsWithoutConcurrentNoise,
  transactionWindowStatements,
} from '../test/helpers/stock-transfer-statement-counter.js';

describe('stockTransferHandlerStatements', () => {
  it('keeps BEGIN through COMMIT and response tail reads', () => {
    const sql = [
      'SELECT FROM users',
      'BEGIN',
      'UPDATE stock_transfer_lines SET approved_qty = 1',
      'UPDATE stock_transfers SET status = $1',
      'COMMIT',
      'SELECT FROM storage_locations WHERE id = $1',
      'SELECT FROM users',
    ];
    expect(stockTransferHandlerStatements(sql)).toEqual([
      'BEGIN',
      'UPDATE stock_transfer_lines SET approved_qty = 1',
      'UPDATE stock_transfers SET status = $1',
      'COMMIT',
      'SELECT FROM storage_locations WHERE id = $1',
    ]);
  });

  it('drops concurrent-suite noise inside the transaction window', () => {
    const sql = [
      'BEGIN',
      'INSERT INTO invoice_lines VALUES ($1)',
      'UPDATE stock_transfers SET status = $1',
      'COMMIT',
    ];
    expect(stockTransferHandlerStatements(sql)).toEqual([
      'BEGIN',
      'UPDATE stock_transfers SET status = $1',
      'COMMIT',
    ]);
  });

  it('filters noise only when no BEGIN is present', () => {
    const sql = [
      'SELECT FROM users',
      'INSERT INTO credit_notes VALUES ($1)',
      'UPDATE stock_transfers SET status = $1',
    ];
    expect(stockTransferHandlerStatements(sql)).toEqual([
      'SELECT FROM users',
      'UPDATE stock_transfers SET status = $1',
    ]);
  });

  it('stops the response tail at the first non-tail statement', () => {
    const sql = [
      'BEGIN',
      'UPDATE stock_transfers SET status = $1',
      'COMMIT',
      'SELECT FROM storage_locations WHERE id = $1',
      'SELECT FROM catalog_items WHERE id = $1',
    ];
    expect(stockTransferHandlerStatements(sql)).toEqual([
      'BEGIN',
      'UPDATE stock_transfers SET status = $1',
      'COMMIT',
      'SELECT FROM storage_locations WHERE id = $1',
    ]);
  });
});

describe('stock-transfer statement predicates', () => {
  it('detects transaction framing', () => {
    expect(isStockTransferTransactionBegin('BEGIN')).toBe(true);
    expect(isStockTransferTransactionCommit('  COMMIT ')).toBe(true);
    expect(isStockTransferTransactionBegin('SELECT 1')).toBe(false);
  });

  it('flags concurrent suite noise tables', () => {
    expect(isConcurrentSuiteNoiseStatement('INSERT INTO invoice_lines')).toBe(true);
    expect(
      isConcurrentSuiteNoiseStatement('UPDATE stock_transfers SET status = $1'),
    ).toBe(false);
  });

  it('flags response tail tables only', () => {
    expect(isStockTransferResponseTailStatement('SELECT stock_transfer_lines')).toBe(
      true,
    );
    expect(isStockTransferResponseTailStatement('SELECT FROM sites')).toBe(false);
  });
});

describe('stock-transfer statement window helpers', () => {
  it('finds the first BEGIN', () => {
    expect(indexOfFirstBegin(['SELECT 1', 'BEGIN', 'COMMIT'])).toBe(1);
    expect(indexOfFirstBegin(['SELECT 1'])).toBe(-1);
  });

  it('collects the transaction window through COMMIT', () => {
    const sql = ['BEGIN', 'UPDATE stock_transfers SET status = $1', 'COMMIT', 'SELECT 1'];
    expect(transactionWindowStatements(sql, 0)).toEqual({
      statements: ['BEGIN', 'UPDATE stock_transfers SET status = $1', 'COMMIT'],
      commitIndex: 2,
    });
  });

  it('filters noise without a transaction', () => {
    expect(
      statementsWithoutConcurrentNoise([
        'UPDATE stock_transfers SET status = $1',
        'INSERT INTO vehicle_media',
      ]),
    ).toEqual(['UPDATE stock_transfers SET status = $1']);
  });

  it('appends tail statements after commit', () => {
    const sql = [
      'BEGIN',
      'COMMIT',
      'SELECT storage_locations',
      'SELECT users',
    ];
    expect(appendResponseTailStatements(sql, 1, ['BEGIN', 'COMMIT'])).toEqual([
      'BEGIN',
      'COMMIT',
      'SELECT storage_locations',
    ]);
  });
});
