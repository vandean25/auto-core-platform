import { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import type { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import {
  type ImportApplyInput,
  type ImportApplyPreparation,
  type ImportApplyRow,
  type ImportDryRunInput,
  type ImportTypeHandler,
} from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import { applyVehicleImportRow } from './vehicle-import-apply.row.js';
import { planVehicleDryRun } from './vehicle-import.dry-run.js';

/** Vehicle imports. Rows are written one at a time, like customer imports. */
export class VehicleImportHandler implements ImportTypeHandler {
  readonly entityType = ImportEntityType.VEHICLE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ImportAuditWriter,
    private readonly rowRunner: RowByRowApplyRunner,
  ) {}

  sortRowsForApplySequence(rows: ImportApplyRow[]): ImportApplyRow[] {
    return [...rows].sort((a, b) => a.row_no - b.row_no);
  }

  prepareCreate(): Promise<void> {
    return Promise.resolve();
  }

  planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]> {
    return planVehicleDryRun(this.prisma, input, parsed);
  }

  prepareApply(): Promise<ImportApplyPreparation> {
    return Promise.resolve({ vendor: null });
  }

  apply(input: ImportApplyInput): Promise<SerializedImportJob> {
    const audit = this.audit;
    return this.rowRunner.run(
      input,
      this.entityType,
      (tx, row) =>
        applyVehicleImportRow(
          tx,
          {
            tenantId: input.tenantId,
            job: input.job,
            actorUserId: input.actorUserId,
            audit,
          },
          row,
        ),
      input.batchOptions,
    );
  }
}
