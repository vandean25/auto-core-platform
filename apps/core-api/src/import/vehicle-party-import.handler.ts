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
  expandVehiclePartyBatchWithLookahead,
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

  // Owner transfers end the old interval (UPDATE) before the new owner (CREATE).
  // Background batches merge a peeked UPDATE and sort updates first; the worker
  // cursor uses the highest committed row_no so later rows are not replayed.
  protected override orderRows(
    rows: ImportApplyRow[],
    input: ImportApplyInput,
  ): ImportApplyRow[] {
    void input;
    return orderVehiclePartyApplyRows(rows);
  }

  override apply(input: ImportApplyInput): Promise<SerializedImportJob> {
    const batchOptions = input.batchOptions;
    let rows = input.rows;
    if (batchOptions?.stopAfterBatch) {
      rows = expandVehiclePartyBatchWithLookahead(
        rows,
        batchOptions.lookaheadRows ?? [],
      );
    }
    return this.rowRunner.run(
      { ...input, rows: this.orderRows(rows, input) },
      this.entityType,
      (tx, row) => this.writeRow(tx, row, input),
      batchOptions,
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
