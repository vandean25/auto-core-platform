import { InvoiceStatus, Prisma } from '@prisma/client';
import {
  parseReconcileIssuedInvoiceTotalsArgv,
  reconcileIssuedInvoiceTotals,
  type IssuedInvoiceTotalsStore,
} from './reconcile-issued-invoice-totals.js';

type FakeInvoiceRow = {
  id: string;
  tenant_id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  total_gross: Prisma.Decimal;
  snapshot: unknown;
};

function storeFrom(rows: FakeInvoiceRow[]): IssuedInvoiceTotalsStore & {
  rows: FakeInvoiceRow[];
} {
  const state = rows.map((row) => ({ ...row }));
  return {
    rows: state,
    invoice: {
      findMany: async ({ where, take }) => {
        const filtered = state.filter((row) => {
          if (where.tenant_id && row.tenant_id !== where.tenant_id) {
            return false;
          }
          if (where.status?.in && !where.status.in.includes(row.status)) {
            return false;
          }
          if (where.id?.gt && row.id <= where.id.gt) {
            return false;
          }
          return true;
        });
        return filtered.slice(0, take);
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state) {
          if (row.id === where.id && row.tenant_id === where.tenant_id) {
            row.total_net = data.total_net;
            row.total_tax = data.total_tax;
            row.total_gross = data.total_gross;
            count += 1;
          }
        }
        return { count };
      },
    },
  };
}

describe('reconcile-issued-invoice-totals', () => {
  it('defaults to dry-run and parses --apply and --tenant-id', () => {
    expect(
      parseReconcileIssuedInvoiceTotalsArgv(['node', 'script.ts']),
    ).toEqual({
      apply: false,
      tenantId: undefined,
    });
    expect(
      parseReconcileIssuedInvoiceTotalsArgv([
        'node',
        'script.ts',
        '--apply',
        '--tenant-id',
        'tenant-1',
      ]),
    ).toEqual({
      apply: true,
      tenantId: 'tenant-1',
    });
  });

  it('rejects conflicting --dry-run and --apply flags', () => {
    expect(() =>
      parseReconcileIssuedInvoiceTotalsArgv([
        'node',
        'script.ts',
        '--dry-run',
        '--apply',
      ]),
    ).toThrow(/either --dry-run or --apply/);
  });

  it('Scenario 7: dry-run reports mismatched issued invoice without mutating; --apply fixes it and second run reports zero', async () => {
    const store = storeFrom([
      {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        invoice_number: 'RE-2026-0001',
        status: InvoiceStatus.ISSUED,
        total_net: new Prisma.Decimal('24.76'),
        total_tax: new Prisma.Decimal('4.95'),
        total_gross: new Prisma.Decimal('29.71'),
        snapshot: {
          total_net: '24.76',
          total_tax: '4.96',
          total_gross: '29.72',
        },
      },
      {
        id: 'inv-2',
        tenant_id: 'tenant-1',
        invoice_number: 'RE-2026-0002',
        status: InvoiceStatus.FINALIZED,
        total_net: new Prisma.Decimal('100.00'),
        total_tax: new Prisma.Decimal('20.00'),
        total_gross: new Prisma.Decimal('120.00'),
        snapshot: {
          total_net: '100.00',
          total_tax: '20.00',
          total_gross: '120.00',
        },
      },
    ]);

    const dryRunResult = await reconcileIssuedInvoiceTotals(store, {
      apply: false,
      tenantId: 'tenant-1',
    });

    expect(dryRunResult.updated).toBe(0);
    expect(dryRunResult.mismatches).toEqual([
      {
        id: 'inv-1',
        number: 'RE-2026-0001',
        tenant: 'tenant-1',
        stored: {
          total_net: '24.76',
          total_tax: '4.95',
          total_gross: '29.71',
        },
        snapshot: {
          total_net: '24.76',
          total_tax: '4.96',
          total_gross: '29.72',
        },
        diff: {
          total_net: '0.00',
          total_tax: '0.01',
          total_gross: '0.01',
        },
      },
    ]);
    expect(store.rows[0].total_gross.toFixed(2)).toBe('29.71');

    const applyResult = await reconcileIssuedInvoiceTotals(store, {
      apply: true,
      tenantId: 'tenant-1',
    });

    expect(applyResult.updated).toBe(1);
    expect(applyResult.mismatches).toHaveLength(1);
    expect(store.rows[0].total_net.toFixed(2)).toBe('24.76');
    expect(store.rows[0].total_tax.toFixed(2)).toBe('4.96');
    expect(store.rows[0].total_gross.toFixed(2)).toBe('29.72');

    const secondRun = await reconcileIssuedInvoiceTotals(store, {
      apply: false,
      tenantId: 'tenant-1',
    });
    expect(secondRun.mismatches).toEqual([]);
    expect(secondRun.updated).toBe(0);
  });

  it('scopes queries and updates to the specified tenant', async () => {
    const store = storeFrom([
      {
        id: 'inv-a',
        tenant_id: 'tenant-a',
        invoice_number: 'RE-2026-0001',
        status: InvoiceStatus.ISSUED,
        total_net: new Prisma.Decimal('24.76'),
        total_tax: new Prisma.Decimal('4.95'),
        total_gross: new Prisma.Decimal('29.71'),
        snapshot: {
          total_net: '24.76',
          total_tax: '4.96',
          total_gross: '29.72',
        },
      },
      {
        id: 'inv-b',
        tenant_id: 'tenant-b',
        invoice_number: 'RE-2026-0001',
        status: InvoiceStatus.ISSUED,
        total_net: new Prisma.Decimal('24.76'),
        total_tax: new Prisma.Decimal('4.95'),
        total_gross: new Prisma.Decimal('29.71'),
        snapshot: {
          total_net: '24.76',
          total_tax: '4.96',
          total_gross: '29.72',
        },
      },
    ]);

    const result = await reconcileIssuedInvoiceTotals(store, {
      apply: true,
      tenantId: 'tenant-a',
    });

    expect(result.mismatches.map((m) => m.id)).toEqual(['inv-a']);
    expect(store.rows[0].total_gross.toFixed(2)).toBe('29.72');
    expect(store.rows[1].total_gross.toFixed(2)).toBe('29.71');
  });
});
