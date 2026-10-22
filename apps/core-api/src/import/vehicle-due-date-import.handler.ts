import { ImportEntityType, type Prisma } from '@prisma/client';
import type { ParsedCsv } from './csv-parse.util.js';
import type {
  ImportApplyInput,
  ImportApplyRow,
  ImportDryRunInput,
} from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import { RowByRowImportHandler } from './row-by-row-import.handler.js';
import { applyVehicleDueDateImportRow } from './vehicle-due-date-import.apply.js';
import { planVehicleDueDateDryRun } from './vehicle-due-date-import.dry-run.js';

/** Vehicle due date imports (canonical vehicle_due_dates.csv). */
export class VehicleDueDateImportHandler extends RowByRowImportHandler {
  readonly entityType = ImportEntityType.VEHICLE_DUE_DATE;

  planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]> {
    return planVehicleDueDateDryRun(this.prisma, input, parsed);
  }

  protected writeRow(
    tx: Prisma.TransactionClient,
    row: ImportApplyRow,
    input: ImportApplyInput,
  ): Promise<void> {
    return applyVehicleDueDateImportRow(
      tx,
      {
        tenantId: input.tenantId,
        job: input.job,
        actorUserId: input.actorUserId,
        audit: this.audit,
      },
      row,
    );
  }
}
