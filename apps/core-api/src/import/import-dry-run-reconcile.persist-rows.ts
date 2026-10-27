import { Prisma, type ImportRowAction } from '@prisma/client';
import type { DryRunRowResult } from './import.types.js';

export type DryRunRowUpdatePayload = {
  external_id: string | null;
  action: ImportRowAction;
  entity_id: string | null;
  errors_json: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  warnings_json: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  normalized_json: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

export function dryRunRowWritableFields(
  row: DryRunRowResult,
): DryRunRowUpdatePayload {
  return {
    external_id: row.external_id,
    action: row.action,
    entity_id: row.entity_id,
    errors_json: row.errors.length > 0 ? row.errors : Prisma.JsonNull,
    warnings_json: row.warnings.length > 0 ? row.warnings : Prisma.JsonNull,
    normalized_json:
      row.normalized === null
        ? Prisma.JsonNull
        : (row.normalized as Prisma.InputJsonValue),
  };
}

export function dryRunRowUpdatePayload(
  row: DryRunRowResult,
): DryRunRowUpdatePayload {
  return dryRunRowWritableFields(row);
}

export function dryRunRowCreateInput(row: DryRunRowResult) {
  return {
    row_no: row.row_no,
    ...dryRunRowWritableFields(row),
  };
}

function payloadGroupKey(payload: DryRunRowUpdatePayload): string {
  return JSON.stringify(payload);
}

/** Groups identical row rewrites into updateMany batches (never one update per row by default). */
export async function persistGroupedDryRunRowUpdates(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  rows: DryRunRowResult[],
): Promise<void> {
  const groups = new Map<
    string,
    { payload: DryRunRowUpdatePayload; rowNos: number[] }
  >();
  for (const row of rows) {
    const payload = dryRunRowUpdatePayload(row);
    const key = payloadGroupKey(payload);
    const existing = groups.get(key);
    if (existing) {
      existing.rowNos.push(row.row_no);
      continue;
    }
    groups.set(key, { payload, rowNos: [row.row_no] });
  }
  for (const { payload, rowNos } of groups.values()) {
    await tx.importJobRow.updateMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: { in: rowNos },
      },
      data: payload,
    });
  }
}
