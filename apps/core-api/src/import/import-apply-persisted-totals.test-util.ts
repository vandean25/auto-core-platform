import { ImportRowAction } from '@prisma/client';
import { jest } from '@jest/globals';

/** Adds groupBy + job metadata mocks needed when markJobApplied runs in tests. */
export function withApplyPersistedTotalsTransactionClient(
  tx: Record<string, unknown>,
  defaults?: {
    tenantId?: string;
    expectedRows?: number;
    persistedRows?: Array<{ action: ImportRowAction; row_no?: number }>;
    actionsByRow?: Map<number, ImportRowAction>;
  },
): Record<string, unknown> {
  const tenantId = defaults?.tenantId ?? 'tenant-1';
  const expectedRows = defaults?.expectedRows ?? 1;
  const actionsByRow =
    defaults?.actionsByRow ?? new Map<number, ImportRowAction>();
  if (!defaults?.actionsByRow) {
    defaults?.persistedRows?.forEach((row, index) => {
      actionsByRow.set(row.row_no ?? index + 1, row.action);
    });
  }
  const existingRowClient = (tx.importJobRow ?? {}) as Record<string, unknown>;
  const rowUpdate = existingRowClient.update as
    | jest.Mock
    | ((args: { data?: { action?: ImportRowAction } }) => Promise<unknown>)
    | undefined;
  const groupedActions = () => {
    const actionCounts = new Map<ImportRowAction, number>();
    for (const action of actionsByRow.values()) {
      actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
    }
    if (actionCounts.size === 0) {
      return [
        { action: ImportRowAction.CREATE, _count: { _all: expectedRows } },
      ];
    }
    return [...actionCounts.entries()].map(([action, count]) => ({
      action,
      _count: { _all: count },
    }));
  };
  const importJobRow = {
    ...existingRowClient,
    groupBy:
      existingRowClient.groupBy ??
      jest.fn(() => Promise.resolve(groupedActions())),
    update: jest.fn(
      (args: {
        where?: {
          row_no?: number;
          tenant_id_import_job_id_row_no?: { row_no?: number };
        };
        data?: { action?: ImportRowAction };
      }) => {
        const rowNo =
          args.where?.tenant_id_import_job_id_row_no?.row_no ??
          args.where?.row_no;
        if (args.data?.action && rowNo !== undefined) {
          actionsByRow.set(rowNo, args.data.action);
        }
        return rowUpdate?.(args);
      },
    ),
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
