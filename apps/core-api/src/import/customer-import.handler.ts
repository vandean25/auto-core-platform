import { Logger } from '@nestjs/common';
import { ImportEntityType } from '@prisma/client';
import type { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import type { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { applyCustomerImportRow } from './customer-import.apply.js';
import { planCustomerDryRun } from './customer-import.dry-run.js';
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
import { IMPORT_LOGGER_CONTEXT } from './import.constants.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { DryRunRowResult, ImportJobTotals } from './import.types.js';

/**
 * Customer imports. After a dry run, the tenant's decision mode decides whether the rows go
 * live or are only shadow-scheduled for comparison.
 */
export class CustomerImportHandler implements ImportTypeHandler {
  readonly entityType = ImportEntityType.CUSTOMER;
  private readonly logger = new Logger(IMPORT_LOGGER_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ImportAuditWriter,
    private readonly rowRunner: RowByRowApplyRunner,
    private readonly decisionHooks: DecisionUseCaseHooksService,
    private readonly decisionLive: DecisionLiveApplyService,
    private readonly requestContext: RequestContextService,
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
    return planCustomerDryRun(this.prisma, input, parsed);
  }

  async finishCreate(input: {
    tenantId: string;
    jobId: string;
    rows: DryRunRowResult[];
    totals: ImportJobTotals;
  }): Promise<ImportJobTotals> {
    const { tenantId, jobId, rows, totals } = input;
    const liveImport = await this.decisionLive.applyCustomerImportDecisions({
      tenantId,
      traceId: this.requestContext.getTraceId(),
      jobId,
      rows,
      totals,
    });
    if (liveImport.mode === 'live') {
      return liveImport.totals;
    }

    void this.decisionHooks
      .scheduleCustomerImportDryRunShadows(
        tenantId,
        this.requestContext.getTraceId(),
        rows,
      )
      .catch((error) => {
        this.logger.debug(
          `Decision import shadow scheduling failed: ${String(error)}`,
        );
      });
    return totals;
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
        applyCustomerImportRow(
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
