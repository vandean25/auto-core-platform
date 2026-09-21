import { computeSignedTotals } from './accounting-export-candidates.js';
import type { AccountingExportBookingRow } from './accounting-export.types.js';

describe('computeSignedTotals', () => {
  const baseRow = (
    overrides: Partial<AccountingExportBookingRow>,
  ): AccountingExportBookingRow => ({
    documentId: 'doc-1',
    documentKind: 'INVOICE',
    documentNumber: 'RE-1',
    documentDate: '2026-01-10',
    lineId: 'line-1',
    polarity: 'S',
    net: '100.00',
    tax: '20.00',
    taxRate: '20.00',
    gross: '120.00',
    debtorAccount: '1000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-1',
    ...overrides,
  });

  it('buckets signed totals by revenue account and frozen tax rate', () => {
    const totals = computeSignedTotals([
      baseRow({ lineId: 'line-1', taxRate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' }),
      baseRow({
        lineId: 'line-2',
        taxRate: '7.00',
        net: '50.00',
        tax: '3.50',
        gross: '53.50',
      }),
      baseRow({
        documentKind: 'CREDIT_NOTE',
        lineId: 'line-3',
        polarity: 'H',
        taxRate: '20.00',
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
      }),
    ]);

    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '0.00',
        tax: '0.00',
        gross: '0.00',
      },
      {
        account: '8400',
        taxRate: '7.00',
        net: '50.00',
        tax: '3.50',
        gross: '53.50',
      },
    ]);
  });
});
