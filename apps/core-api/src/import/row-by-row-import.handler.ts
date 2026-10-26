import type { ImportEntityType, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type {
  ImportApplyInput,
  ImportApplyPreparation,
  ImportApplyRow,
  ImportDryRunInput,
  ImportTypeHandler,
} from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import { sortImportApplyRowsByRowNo } from './import-apply-sequence.js';

/** Shared shape of the handlers that plan a CSV in memory and write one row per transaction. */
export abstract class RowByRowImportHandler implements ImportTypeHandler {
  abstract readonly entityType: ImportEntityType;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: ImportAuditWriter,
    protected readonly rowRunner: RowByRowApplyRunner,
  ) {}

  prepareCreate(): Promise<void> {
    return Promise.resolve();
  }

  prepareApply(): Promise<ImportApplyPreparation> {
    return Promise.resolve({ vendor: null });
  }

  abstract planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]>;

  /** Writes one planned row inside the transaction that also runs the freshness check. */
  protected abstract writeRow(
    tx: Prisma.TransactionClient,
    row: ImportApplyRow,
    input: ImportApplyInput,
  ): Promise<void>;

  /** The order rows are applied in. File order unless a handler needs another. */
  protected orderRows(
    rows: ImportApplyRow[],
    input: ImportApplyInput,
  ): ImportApplyRow[] {
    void input;
    return rows;
  }

  sortRowsForApplySequence(rows: ImportApplyRow[]): ImportApplyRow[] {
    return sortImportApplyRowsByRowNo(rows);
  }

  apply(input: ImportApplyInput): Promise<SerializedImportJob> {
    const rows =
      input.batchOptions?.stopAfterBatch && input.batchOptions.useApplySequence
        ? input.rows
        : this.orderRows(input.rows, input);
    return this.rowRunner.run(
      { ...input, rows },
      this.entityType,
      (tx, row) => this.writeRow(tx, row, input),
      input.batchOptions,
    );
  }
}
