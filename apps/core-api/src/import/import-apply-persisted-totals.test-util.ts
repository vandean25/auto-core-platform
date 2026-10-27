import { ImportRowAction } from '@prisma/client';
import { jest } from '@jest/globals';

function groupByCountsFromRowActions(
  rows: Array<{ action: ImportRowAction }>,
): Array<{ action: ImportRowAction; _count: { _all: number } }> {
  const counts = new Map<ImportRowAction, number>();
  for (const row of rows) {
    counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
  }
  return [...counts.entries()].map(([action, count]) => ({
    action,
    _count: { _all: count },
  }));
}

/** Adds groupBy + job metadata mocks needed when markJobApplied runs in tests. */
export function withApplyPersistedTotalsTransactionClient(
  tx: Record<string, unknown>,
  defaults?: {
    tenantId?: string;
    expectedRows?: number;
    persistedRows?: Array<{ action: ImportRowAction }>;
  },
): Record<string, unknown> {
  const tenantId = defaults?.tenantId ?? 'tenant-1';
  const expectedRows = defaults?.expectedRows ?? 1;
  const actionCounts = new Map<ImportRowAction, number>();
  if (defaults?.persistedRows?.length) {
    for (const row of defaults.persistedRows) {
      actionCounts.set(row.action, (actionCounts.get(row.action) ?? 0) + 1);
    }
  }
  const existingRowClient = (tx.importJobRow ?? {}) as Record<string, unknown>;
  const rowUpdate = existingRowClient.update as
    | jest.Mock
    | ((args: { data?: { action?: ImportRowAction } }) => Promise<unknown>)
    | undefined;
  const importJobRow = {
    ...existingRowClient,
    groupBy:
      existingRowClient.groupBy ??
      jest.fn(() => {
        if (actionCounts.size === 0) {
          return Promise.resolve([
            { action: ImportRowAction.CREATE, _count: { _all: expectedRows } },
          ]);
        }
        return Promise.resolve(
          [...actionCounts.entries()].map(([action, count]) => ({
            action,
            _count: { _all: count },
          })),
        );
      }),
    update: jest.fn((args: { data?: { action?: ImportRowAction } }) => {
      if (args.data?.action) {
        actionCounts.set(
          args.data.action,
          (actionCounts.get(args.data.action) ?? 0) + 1,
        );
      }
      return rowUpdate?.(args);
    }),
  };
  const existingJobClient = (tx.importJob ?? {}) as Record<string, unknown>;
  const importJob = {
    ...existingJobClient,
    findFirst:
      existingJobClient.findFirst ??
      jest.fn(() =>
        Promise.resolve({
          tenant_id: tenantId,
          totals_json: {
            rows: expectedRows,
            create: 0,
            update: 0,
            skip: 0,
            error: 0,
          },
        }),
      ),
  };
  return { ...tx, importJobRow, importJob };
}
