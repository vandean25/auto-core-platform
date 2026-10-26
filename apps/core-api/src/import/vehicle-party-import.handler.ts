import { ImportEntityType, type Prisma } from '@prisma/client';
import type { ParsedCsv } from './csv-parse.util.js';
import type {
  ImportApplyInput,
  ImportApplyRow,
  ImportDryRunInput,
} from './import-type-handler.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { DryRunRowResult } from './import.types.js';
import { RowByRowImportHandler } from './row-by-row-import.handler.js';
import { applyVehiclePartyImportRow } from './vehicle-party-import.apply.js';
import {
  buildVehiclePartyBackgroundApplyRows,
  orderVehiclePartyApplyRows,
} from './vehicle-party-import.batch-rows.js';
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

  protected override orderRows(
    rows: ImportApplyRow[],
    input: ImportApplyInput,
  ): ImportApplyRow[] {
    void input;
    return orderVehiclePartyApplyRows(rows);
  }

  override apply(input: ImportApplyInput): Promise<SerializedImportJob> {
    const batchOptions = input.batchOptions;
    if (batchOptions?.stopAfterBatch) {
      const rows = buildVehiclePartyBackgroundApplyRows(
        input.rows,
        batchOptions.lookaheadRows ?? [],
      );
      return this.rowRunner.run(
        { ...input, rows },
        this.entityType,
        (tx, row) => this.writeRow(tx, row, input),
        { ...batchOptions, applyEntireWorkerPage: true },
      );
    }
    return super.apply(input);
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
