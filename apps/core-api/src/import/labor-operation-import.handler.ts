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
import { applyLaborOperationImportRow } from './labor-operation-import.apply.js';
import { planLaborOperationDryRun } from './labor-operation-import.dry-run.js';
import { sortImportApplyRowsByRowNo } from './import-apply-sequence.js';

/** Labor operation (Arbeitswerte) imports. */
export class LaborOperationImportHandler implements ImportTypeHandler {
  readonly entityType = ImportEntityType.LABOR_OPERATION;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ImportAuditWriter,
    private readonly rowRunner: RowByRowApplyRunner,
  ) {}

  sortRowsForApplySequence(rows: ImportApplyRow[]): ImportApplyRow[] {
    return sortImportApplyRowsByRowNo(rows);
  }

  prepareCreate(): Promise<void> {
    return Promise.resolve();
  }

  planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]> {
    return planLaborOperationDryRun(this.prisma, input, parsed);
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
        applyLaborOperationImportRow(
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
