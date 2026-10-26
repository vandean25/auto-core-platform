import { ImportEntityType, type Prisma } from '@prisma/client';
import type { ParsedCsv } from './csv-parse.util.js';
import type {
  ImportApplyInput,
  ImportApplyRow,
  ImportDryRunInput,
} from './import-type-handler.js';
import { RowByRowImportHandler } from './row-by-row-import.handler.js';
import { applyVehiclePartyImportRow } from './vehicle-party-import.apply.js';
import {
  orderVehiclePartyApplyRows,
  vehiclePartyApplySequenceOrderSql,
} from './vehicle-party-import.apply-order.js';
import { planVehiclePartyDryRun } from './vehicle-party-import.dry-run.js';
import type { DryRunRowResult } from './import.types.js';

/** Vehicle party imports (canonical vehicle_parties.csv). */
export class VehiclePartyImportHandler extends RowByRowImportHandler {
  readonly entityType = ImportEntityType.VEHICLE_PARTY;

  planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]> {
    return planVehiclePartyDryRun(this.prisma, input, parsed);
  }

  override applySequenceOrderSql(): string {
    return vehiclePartyApplySequenceOrderSql();
  }

  protected override orderRows(
    rows: ImportApplyRow[],
    input: ImportApplyInput,
  ): ImportApplyRow[] {
    void input;
    return orderVehiclePartyApplyRows(rows);
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
