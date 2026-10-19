import {
  computeMigrationStockValue,
} from './migration-manifest-csv.validation.js';
import {
  headerOnlyCanonicalCsvBytes,
  parseCanonicalMigrationCsv,
} from './migration-csv-parse.util.js';
import {
  lineMoneyCentsFromQtyAndUnit,
  formatMoneyFromCents,
  sumMoneyStrings,
} from './migration-money.util.js';

describe('migration-money.util', () => {
  it('half-ups qty × unit to cents (0.004 × 36.25 → 0.15)', () => {
    const cents = lineMoneyCentsFromQtyAndUnit('0.004', '36.25');
    expect(formatMoneyFromCents(cents)).toBe('0.15');
  });

  it('sums money without float drift', () => {
    expect(sumMoneyStrings(['0.10', '0.20'])).toBe('0.30');
  });
});

describe('computeMigrationStockValue', () => {
  it('uses per-line half-up before summing', () => {
    const header = headerOnlyCanonicalCsvBytes('stock_opening.csv');
    const headers = header.toString('utf8').trim().split(',');
    const row = [
      'row-1',
      'part-1',
      'SITE',
      'BIN',
      '0.004',
      '36.25',
    ].join(',');
    const buffer = Buffer.from(`${headers.join(',')}\r\n${row}\r\n`, 'utf8');
    const parsed = parseCanonicalMigrationCsv(buffer);
    expect(computeMigrationStockValue(parsed)).toBe('0.15');
  });
});
