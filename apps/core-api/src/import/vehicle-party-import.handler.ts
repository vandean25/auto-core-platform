import { ImportEntityType, ImportRowAction, type Prisma } from '@prisma/client';
import type { ParsedCsv } from './csv-parse.util.js';
import type {
  ImportApplyInput,
  ImportApplyRow,
  ImportDryRunInput,
} from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import { RowByRowImportHandler } from './row-by-row-import.handler.js';
import { applyVehiclePartyImportRow } from './vehicle-party-import.apply.js';
import { planVehiclePartyDryRun } from './vehicle-party-import.dry-run.js';

/** Vehicle party imports (canonical vehicle_parties.csv). */
export class VehiclePartyImportHandler extends RowByRowImportHandler {
  readonly entityType = ImportEntityType.VEHICLE_PARTY;

  planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]> {
    return planVehiclePartyDryRun(this.prisma, input, parsed);
  }

  // An owner transfer ends the old interval (UPDATE) before the new owner starts (CREATE).
  protected override orderRows(rows: ImportApplyRow[]): ImportApplyRow[] {
    return [...rows].sort(
      (a, b) =>
        Number(b.action === ImportRowAction.UPDATE) -
        Number(a.action === ImportRowAction.UPDATE),
    );
  }

  protected writeRow(
    tx: Prisma.TransactionClient,
    row: ImportApplyRow,
    input: ImportApplyInput,
  ): Promise<void> {
    return applyVehiclePartyImportRow(
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
