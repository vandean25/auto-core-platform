import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AuditLogAction,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type {
  CatalogPriceHistory,
  ImportJob,
  ImportJobRow,
} from '@prisma/client';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { describeImportApplyCause } from './import-apply.errors.js';
import { ImportAuditWriter } from './import-audit.writer.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import { enqueueOrRunImportWorker } from './import-dispatch.js';
import {
  assertImportJobRowsAvailable,
  importJobBusy,
  importJobConflict,
  importJobNotFound,
  importJobNotUndoable,
} from './import-job.errors.js';
import {
  serializeImportJob,
  type SerializedImportJob,
} from './import-job.serializer.js';
import {
  readImportUndoBatchSize,
  readImportUndoUnitBudgetMs,
  readImportUndoUnitRowBudget,
} from './import-limits.js';
import { IMPORT_LOGGER_CONTEXT } from './import.constants.js';
import { hasUndoableRows } from './import-undo.helpers.js';
import { UNDO_BLOCKED_REASONS } from './import-undo.types.js';
import {
  IMPORT_UNDO_BATCH_TX,
  UNDO_RELEASED_LEASE_UNTIL,
  createUndoWorkerState,
  isUndoClaimStale,
  isUndoLeaseHeld,
  nextUndoLeaseUntil,
  readUndoOutcome,
  readUndoWorkerState,
  undoLeaseHolderPrefix,
  type ImportJobOptionsWithUndo,
  type ImportUndoOutcome,
  type ImportUndoWorkerState,
} from './import-undo-worker.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import { resolveImportWorkerTargetBaseUrl } from './import-worker-target.js';
import {
  SUPPLIER_PRICE_LIST_ENTITY_TYPE,
  planUndoPriceEntries,
  planUndoRows,
  undoRowKey,
  type UndoPlanParams,
  type UndoPricePlanItem,
  type UndoRowPlanItem,
} from './import-undo-plan.js';
import {
  deleteCreatedEntity,
  restoreUpdatedEntity,
} from './import-undo-writer.js';
import { isDocOrFinancialImport } from './import-undo.guard.js';
import type { UndoImportJobDto } from './dto/undo-import-job.dto.js';
import type { ImportJobTotals } from './import.types.js';

type UndoActor = {
  userId: string;
  email: string | null;
  role: string | null;
};

/** Committed undo counters, written together with the rows they describe. */
type UndoProgress = {
  cursor: string;
  processedRows: number;
  deleted: number;
  restored: number;
};

type UndoRunContext = UndoProgress & {
  tenantId: string;
  jobId: string;
  entityType: string;
  actor: UndoActor;
  leaseToken: string;
  appliedAt: Date;
  appliedRowsCount: number;
  totalRows: number;
  claimSeq: number;
  recoverySeq: number;
  confirmedEntityIds: Set<string>;
  blockedReasons: Record<string, string>;
};

type UndoBatchOutcome = 'done' | 'continue' | 'lease_lost' | 'abort';

type UndoClaimPlan = {
  worker: ImportUndoWorkerState;
  claimableStatus: Prisma.ImportJobWhereInput['status'];
};

const UNDOABLE_STATUSES = new Set<ImportJobStatus>([
  ImportJobStatus.APPLIED,
  ImportJobStatus.PARTIALLY_UNDONE,
]);

const UNDO_CLAIM_STATUSES = [
  ImportJobStatus.APPLIED,
  ImportJobStatus.PARTIALLY_UNDONE,
  ImportJobStatus.FAILED,
];

function getAppliedRowsCount(totals: ImportJobTotals | null): number {
  if (!totals) return 0;
  return (totals.create || 0) + (totals.update || 0);
}

/**
 * Undo runs as a background worker job: committed batches, a lease with heartbeat,
 * resume after a crash and stale-claim recovery, exactly like the import apply worker.
 */
@Injectable()
export class ImportUndoService {
  private readonly logger = new Logger(IMPORT_LOGGER_CONTEXT);
  private readonly audit: ImportAuditWriter;

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly cloudTasks: ImportCloudTasksService,
  ) {
    this.audit = new ImportAuditWriter(tenantContext);
  }

  async undoJob(
    jobId: string,
    dto?: UndoImportJobDto,
  ): Promise<SerializedImportJob> {
    const outcome = await this.undoJobHttp(jobId, dto);
    return outcome.job;
  }

  async undoJobHttp(
    jobId: string,
    dto?: UndoImportJobDto,
  ): Promise<{ httpStatus: 200 | 202; job: SerializedImportJob }> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    if (!job) {
      throw importJobNotFound();
    }
    if (job.status === ImportJobStatus.UNDONE) {
      return { httpStatus: 200, job: this.serialize(job) };
    }

    const claimed = await this.claimUndoRun(tenantId, job, currentUser, dto);
    await this.dispatchUndo(tenantId, jobId, claimed);

    const current = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    return {
      httpStatus: current?.status === ImportJobStatus.UNDOING ? 202 : 200,
      job: this.serialize(current ?? job),
    };
  }

  private async claimUndoRun(
    tenantId: string,
    job: ImportJob,
    currentUser: { id: string },
    dto?: UndoImportJobDto,
  ): Promise<{ chunkSeq: number; claimSeq: number; recoverySeq: number }> {
    const options = (job.options_json ?? {}) as ImportJobOptionsWithUndo;
    const plan = await this.planUndoClaim(tenantId, job, currentUser, dto);

    const claim = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: job.id,
        updatedAt: job.updatedAt,
        status: plan.claimableStatus,
      },
      data: {
        status: ImportJobStatus.UNDOING,
        // Persisted so a re-run of the same job gets a new Cloud Tasks task id.
        worker_claim_seq: { increment: 1 },
        options_json: {
          ...options,
          undo_worker: plan.worker,
        },
      },
    });
    if (claim.count === 0) {
      throw importJobConflict();
    }
    return {
      chunkSeq: plan.worker.processed_rows,
      claimSeq: job.worker_claim_seq + 1,
      recoverySeq: job.worker_recovery_seq,
    };
  }

  private async planFreshUndoClaim(
    tenantId: string,
    job: ImportJob,
    currentUser: { id: string },
    options: ImportJobOptionsWithUndo,
    confirmedEntityIds: string[],
  ): Promise<UndoClaimPlan> {
    await this.assertJobIsUndoable(tenantId, job);
    return {
      claimableStatus: { in: UNDO_CLAIM_STATUSES },
      worker: await this.buildUndoWorkerState(tenantId, job, currentUser, {
        options,
        confirmedEntityIds,
      }),
    };
  }

  /** Either a fresh claim or the takeover of a stale one; anything else is busy. */
  private async planUndoClaim(
    tenantId: string,
    job: ImportJob,
    currentUser: { id: string },
    dto?: UndoImportJobDto,
  ): Promise<UndoClaimPlan> {
    const options = (job.options_json ?? {}) as ImportJobOptionsWithUndo;
    const existingWorker = readUndoWorkerState(options);
    const confirmedEntityIds =
      dto?.confirmedEntityIds ?? existingWorker?.confirmed_entity_ids ?? [];

    if (job.status !== ImportJobStatus.UNDOING) {
      return this.planFreshUndoClaim(
        tenantId,
        job,
        currentUser,
        options,
        confirmedEntityIds,
      );
    }
    if (!existingWorker || !isUndoClaimStale(existingWorker, Date.now())) {
      // Nothing to adopt: the recovery cron releases a claimless UNDOING job.
      throw importJobBusy();
    }
    return {
      claimableStatus: ImportJobStatus.UNDOING,
      worker: renewUndoClaim(existingWorker, { confirmedEntityIds }),
    };
  }

  private async assertJobIsUndoable(
    tenantId: string,
    job: ImportJob,
  ): Promise<void> {
    if (job.status === ImportJobStatus.APPLYING) {
      throw importJobBusy();
    }
    assertImportJobRowsAvailable(job.options_json);
    if (isDocOrFinancialImport(job.entity_type)) {
      throw importJobNotUndoable();
    }
    const undoable =
      UNDOABLE_STATUSES.has(job.status) ||
      job.status === ImportJobStatus.FAILED;
    if (!undoable) {
      throw importJobNotUndoable();
    }
    const hasRows = await hasUndoableRows(this.prisma, tenantId, job);
    if (!hasRows) {
      throw importJobNotUndoable();
    }
  }

  private async buildUndoWorkerState(
    tenantId: string,
    job: ImportJob,
    currentUser: { id: string },
    params: {
      options: ImportJobOptionsWithUndo;
      confirmedEntityIds: string[];
    },
  ): Promise<ImportUndoWorkerState> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    return createUndoWorkerState({
      actorUserId: currentUser.id,
      actorEmail: authUser?.email || null,
      actorRole: authUser?.role || null,
      resumeStatus: job.status,
      confirmedEntityIds: params.confirmedEntityIds,
      totalRows: await this.countUndoableRows(tenantId, job),
      previous: readUndoOutcome(params.options),
    });
  }

  private async countUndoableRows(
    tenantId: string,
    job: ImportJob,
  ): Promise<number> {
    if (job.entity_type === SUPPLIER_PRICE_LIST_ENTITY_TYPE) {
      return this.prisma.catalogPriceHistory.count({
        where: { tenant_id: tenantId, import_job_id: job.id },
      });
    }
    return this.prisma.importJobRow.count({
      where: {
        tenant_id: tenantId,
        import_job_id: job.id,
        action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
        undone_at: null,
      },
    });
  }

  private async dispatchUndo(
    tenantId: string,
    jobId: string,
    identity: { chunkSeq: number; claimSeq: number; recoverySeq: number },
  ): Promise<void> {
    await enqueueOrRunImportWorker({
      tenantId,
      jobId,
      phase: 'undo',
      cloudTasks: this.cloudTasks,
      targetBaseUrl: resolveImportWorkerTargetBaseUrl(),
      nodeEnv: process.env.NODE_ENV,
      taskIdentity: { jobId, phase: 'undo', ...identity },
      delaySeconds: 0,
      runInline: () =>
        this.runUndoWorkerAttempt({ tenantId, jobId }).catch((error) => {
          this.logUndoFailure('import.undo.attempt_failed', jobId, error);
        }),
    });
  }

  private logUndoFailure(event: string, jobId: string, error: unknown): void {
    this.logger.error(
      JSON.stringify({ event, jobId, cause: describeImportApplyCause(error) }),
    );
  }

  /** One worker unit: claims the lease, batches until the budget runs out, then hands off. */
  async runUndoWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
  }): Promise<void> {
    const ctx = await this.claimUndoWorkerLease(params.tenantId, params.jobId);
    if (!ctx) {
      return;
    }
    const rowBudget = readImportUndoUnitRowBudget();
    const deadline = Date.now() + readImportUndoUnitBudgetMs();
    const startRows = ctx.processedRows;
    while (ctx.processedRows - startRows < rowBudget && Date.now() < deadline) {
      const outcome = await this.commitNextUndoBatch(ctx);
      if (outcome === 'lease_lost' || outcome === 'abort') {
        return;
      }
      if (outcome === 'done') {
        await this.finalizeUndoJob(ctx);
        return;
      }
    }
    await this.handoffUndoContinuation(ctx);
  }

  /**
   * Mints this attempt's lease token with a compare-and-swap on the stored token and on
   * `updatedAt`, so an overlapping delivery of the same Cloud Tasks task never processes the
   * same rows and never starts from another holder's stale progress: the loser matches no row
   * and returns, and every later write of the winner is conditioned on its own token.
   */
  private async claimUndoWorkerLease(
    tenantId: string,
    jobId: string,
  ): Promise<UndoRunContext | null> {
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    if (!job || job.status !== ImportJobStatus.UNDOING) {
      return null;
    }
    const options = (job.options_json ?? {}) as ImportJobOptionsWithUndo;
    const worker = readUndoWorkerState(options);
    if (!worker) {
      return null;
    }
    const now = Date.now();
    if (isUndoLeaseHeld(worker, now)) {
      this.logger.warn(
        JSON.stringify({
          event: 'import.undo.lease_held',
          jobId,
          holder: undoLeaseHolderPrefix(worker.lease_token),
        }),
      );
      return null;
    }
    const leaseToken = randomUUID();
    const claimed = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.UNDOING,
        // The holder's heartbeat and progress writes keep its own token, so the token alone
        // cannot tell whether the state read above is still current. An expired holder that
        // commits one more batch in between must make this claim match no row, otherwise the
        // new holder would overwrite that batch's cursor, counters and blocked reasons.
        updatedAt: job.updatedAt,
        options_json: {
          path: ['undo_worker', 'lease_token'],
          equals: worker.lease_token,
        },
      },
      data: {
        options_json: {
          ...options,
          undo_worker: {
            ...worker,
            lease_token: leaseToken,
            lease_until: nextUndoLeaseUntil(now),
            heartbeat_at: new Date(now).toISOString(),
          },
        },
      },
    });
    if (claimed.count === 0) {
      this.logger.warn(
        JSON.stringify({
          event: 'import.undo.lease_claim_lost',
          jobId,
          holder: undoLeaseHolderPrefix(worker.lease_token),
        }),
      );
      return null;
    }
    return {
      tenantId,
      jobId,
      entityType: job.entity_type,
      actor: {
        userId: worker.actor_user_id,
        email: worker.actor_email,
        role: worker.actor_role,
      },
      leaseToken,
      appliedAt: job.appliedAt ?? job.updatedAt,
      appliedRowsCount: getAppliedRowsCount(
        job.totals_json as ImportJobTotals | null,
      ),
      totalRows: worker.total_rows,
      claimSeq: job.worker_claim_seq,
      recoverySeq: job.worker_recovery_seq,
      confirmedEntityIds: new Set(worker.confirmed_entity_ids),
      blockedReasons: { ...worker.blocked_reasons },
      cursor: worker.cursor,
      processedRows: worker.processed_rows,
      deleted: worker.deleted_rows,
      restored: worker.restored_rows,
    };
  }

  private async handoffUndoContinuation(ctx: UndoRunContext): Promise<void> {
    if (!(await this.releaseUndoLeaseForHandoff(ctx))) {
      this.logger.warn(
        JSON.stringify({
          event: 'import.undo.handoff_skipped',
          jobId: ctx.jobId,
        }),
      );
      return;
    }
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: ctx.tenantId, id: ctx.jobId },
      select: {
        status: true,
        worker_claim_seq: true,
        worker_recovery_seq: true,
      },
    });
    if (job?.status !== ImportJobStatus.UNDOING) {
      return;
    }
    await this.dispatchUndo(ctx.tenantId, ctx.jobId, {
      chunkSeq: ctx.processedRows,
      claimSeq: job.worker_claim_seq,
      recoverySeq: job.worker_recovery_seq,
    });
  }

  /**
   * Releases the lease so the continuation attempt can claim it; token-conditioned. Returns
   * false when this attempt no longer owns the job, in which case nothing may be dispatched.
   */
  private async releaseUndoLeaseForHandoff(
    ctx: UndoRunContext,
  ): Promise<boolean> {
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: ctx.tenantId, id: ctx.jobId },
      select: { options_json: true },
    });
    const options = (job?.options_json ?? {}) as ImportJobOptionsWithUndo;
    const worker = readUndoWorkerState(options);
    if (!worker) {
      return false;
    }
    const released = await this.prisma.importJob.updateMany({
      where: this.undoLeaseWhere(ctx),
      data: {
        options_json: {
          ...options,
          undo_worker: {
            ...worker,
            lease_until: UNDO_RELEASED_LEASE_UNTIL,
            heartbeat_at: new Date().toISOString(),
          },
        },
      },
    });
    return released.count === 1;
  }

  /** Matches only while this attempt still owns the job. */
  private undoLeaseWhere(ctx: UndoRunContext): Prisma.ImportJobWhereInput {
    return {
      tenant_id: ctx.tenantId,
      id: ctx.jobId,
      status: ImportJobStatus.UNDOING,
      options_json: {
        path: ['undo_worker', 'lease_token'],
        equals: ctx.leaseToken,
      },
    };
  }

  private commitNextUndoBatch(ctx: UndoRunContext): Promise<UndoBatchOutcome> {
    return ctx.entityType === SUPPLIER_PRICE_LIST_ENTITY_TYPE
      ? this.commitPriceListBatch(ctx)
      : this.commitRowBatch(ctx);
  }

  private planParams(ctx: UndoRunContext): UndoPlanParams {
    return {
      tenantId: ctx.tenantId,
      entityType: ctx.entityType,
      appliedAt: ctx.appliedAt,
      confirmedEntityIds: ctx.confirmedEntityIds,
    };
  }

  private async commitRowBatch(ctx: UndoRunContext): Promise<UndoBatchOutcome> {
    const rows = await this.prisma.importJobRow.findMany({
      where: {
        tenant_id: ctx.tenantId,
        import_job_id: ctx.jobId,
        action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
        undone_at: null,
        row_no: { gt: Number.parseInt(ctx.cursor, 10) || 0 },
      },
      orderBy: { row_no: 'asc' },
      take: readImportUndoBatchSize(),
    });
    if (rows.length === 0) {
      return 'done';
    }
    const cursor = String(rows[rows.length - 1].row_no);
    try {
      const next = await this.prisma.$transaction(
        (tx) => this.applyRowBatchInTx(tx, ctx, rows, cursor),
        IMPORT_UNDO_BATCH_TX,
      );
      this.advance(ctx, next);
      return 'continue';
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        return 'lease_lost';
      }
      this.logUndoFailure('import.undo.batch_failed', ctx.jobId, error);
      return this.retryRowsIndividually(ctx, rows);
    }
  }

  private async applyRowBatchInTx(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    rows: ImportJobRow[],
    cursor: string,
  ): Promise<UndoProgress> {
    const options = await this.assertUndoLeaseInTx(tx, ctx);
    const plan = await planUndoRows(tx, this.planParams(ctx), rows);
    const delta = await this.applyRowPlan(tx, ctx, plan);
    const next = this.nextProgress(ctx, rows.length, cursor, delta);
    await this.persistUndoProgressInTx(tx, ctx, options, next);
    return next;
  }

  /** A batch that fails as a whole is retried row by row so one bad row cannot lose its neighbours. */
  private async retryRowsIndividually(
    ctx: UndoRunContext,
    rows: ImportJobRow[],
  ): Promise<UndoBatchOutcome> {
    for (const row of rows) {
      const outcome = await this.commitSingleRow(ctx, row);
      if (outcome !== 'continue') {
        return outcome;
      }
    }
    return 'continue';
  }

  private async commitSingleRow(
    ctx: UndoRunContext,
    row: ImportJobRow,
  ): Promise<UndoBatchOutcome> {
    const cursor = String(row.row_no);
    try {
      const next = await this.prisma.$transaction(
        (tx) => this.applyRowBatchInTx(tx, ctx, [row], cursor),
        IMPORT_UNDO_BATCH_TX,
      );
      this.advance(ctx, next);
      return 'continue';
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        return 'lease_lost';
      }
      this.logger.warn(
        JSON.stringify({
          event: 'import.undo.row_failed',
          jobId: ctx.jobId,
          rowNo: row.row_no,
          cause: describeImportApplyCause(error),
        }),
      );
      return this.blockFailedRow(ctx, row, cursor);
    }
  }

  private async blockFailedRow(
    ctx: UndoRunContext,
    row: ImportJobRow,
    cursor: string,
  ): Promise<UndoBatchOutcome> {
    try {
      const next = await this.prisma.$transaction(async (tx) => {
        const options = await this.assertUndoLeaseInTx(tx, ctx);
        this.blockEntity(ctx, undoRowKey(row), UNDO_BLOCKED_REASONS.ROW_ERROR);
        const progress = this.nextProgress(ctx, 1, cursor, {
          deleted: 0,
          restored: 0,
        });
        await this.persistUndoProgressInTx(tx, ctx, options, progress);
        return progress;
      }, IMPORT_UNDO_BATCH_TX);
      this.advance(ctx, next);
      return 'continue';
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        return 'lease_lost';
      }
      this.logUndoFailure('import.undo.row_block_failed', ctx.jobId, error);
      return 'abort';
    }
  }

  private async applyRowPlan(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    plan: UndoRowPlanItem[],
  ): Promise<{ deleted: number; restored: number }> {
    let deleted = 0;
    let restored = 0;
    for (const item of plan) {
      if (!item.action) {
        this.blockEntity(ctx, item.key, item.reason);
        continue;
      }
      if (item.action === 'delete') {
        await this.deleteRow(tx, ctx, item);
        deleted++;
        continue;
      }
      await this.restoreRow(tx, ctx, item);
      restored++;
    }
    return { deleted, restored };
  }

  private async deleteRow(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    item: UndoRowPlanItem,
  ): Promise<void> {
    const entityId = item.row.entity_id as string;
    await deleteCreatedEntity(
      tx,
      ctx.tenantId,
      ctx.entityType,
      entityId,
      ctx.jobId,
    );
    await this.audit.writeEntityAudit(
      tx,
      ctx.tenantId,
      ctx.actor.userId,
      ctx.jobId,
      ctx.entityType,
      entityId,
      AuditLogAction.DELETE,
      item.entity ?? item.row.normalized_json,
      null,
    );
    await this.markRowUndone(tx, ctx, item.row.row_no);
    delete ctx.blockedReasons[item.key];
  }

  private async restoreRow(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    item: UndoRowPlanItem,
  ): Promise<void> {
    const entityId = item.row.entity_id as string;
    const beforeSnapshot = item.row.before_snapshot_json as Record<
      string,
      unknown
    >;
    await restoreUpdatedEntity(
      tx,
      ctx.tenantId,
      ctx.entityType,
      entityId,
      beforeSnapshot,
    );
    await this.audit.writeEntityAudit(
      tx,
      ctx.tenantId,
      ctx.actor.userId,
      ctx.jobId,
      ctx.entityType,
      entityId,
      AuditLogAction.UPDATE,
      item.entity ?? item.row.normalized_json,
      beforeSnapshot,
    );
    await this.markRowUndone(tx, ctx, item.row.row_no);
    delete ctx.blockedReasons[item.key];
  }

  private markRowUndone(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    rowNo: number,
  ): Promise<unknown> {
    return tx.importJobRow.update({
      where: {
        tenant_id_import_job_id_row_no: {
          tenant_id: ctx.tenantId,
          import_job_id: ctx.jobId,
          row_no: rowNo,
        },
      },
      data: { undone_at: new Date() },
    });
  }

  private async commitPriceListBatch(
    ctx: UndoRunContext,
  ): Promise<UndoBatchOutcome> {
    const histories = await this.prisma.catalogPriceHistory.findMany({
      where: {
        tenant_id: ctx.tenantId,
        import_job_id: ctx.jobId,
        id: { gt: ctx.cursor },
      },
      orderBy: { id: 'asc' },
      take: readImportUndoBatchSize(),
    });
    if (histories.length === 0) {
      return 'done';
    }
    const cursor = histories[histories.length - 1].id;
    try {
      const next = await this.prisma.$transaction(
        (tx) => this.applyPriceBatchInTx(tx, ctx, histories, cursor),
        IMPORT_UNDO_BATCH_TX,
      );
      this.advance(ctx, next);
      return 'continue';
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        return 'lease_lost';
      }
      this.logUndoFailure('import.undo.price_batch_failed', ctx.jobId, error);
      return this.retryPriceEntriesIndividually(ctx, histories);
    }
  }

  private async applyPriceBatchInTx(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    histories: CatalogPriceHistory[],
    cursor: string,
  ): Promise<UndoProgress> {
    const options = await this.assertUndoLeaseInTx(tx, ctx);
    const plan = await planUndoPriceEntries(
      tx,
      this.planParams(ctx),
      histories,
    );
    const restored = await this.applyPricePlan(tx, ctx, plan);
    const next = this.nextProgress(ctx, histories.length, cursor, {
      deleted: 0,
      restored,
    });
    await this.persistUndoProgressInTx(tx, ctx, options, next);
    return next;
  }

  private async retryPriceEntriesIndividually(
    ctx: UndoRunContext,
    histories: CatalogPriceHistory[],
  ): Promise<UndoBatchOutcome> {
    for (const history of histories) {
      const outcome = await this.commitSinglePriceEntry(ctx, history);
      if (outcome !== 'continue') {
        return outcome;
      }
    }
    return 'continue';
  }

  private async commitSinglePriceEntry(
    ctx: UndoRunContext,
    history: CatalogPriceHistory,
  ): Promise<UndoBatchOutcome> {
    try {
      const next = await this.prisma.$transaction(
        (tx) => this.applyPriceBatchInTx(tx, ctx, [history], history.id),
        IMPORT_UNDO_BATCH_TX,
      );
      this.advance(ctx, next);
      return 'continue';
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        return 'lease_lost';
      }
      this.logger.warn(
        JSON.stringify({
          event: 'import.undo.price_entry_failed',
          jobId: ctx.jobId,
          catalogItemId: history.catalog_item_id,
          cause: describeImportApplyCause(error),
        }),
      );
      return this.blockFailedPriceEntry(ctx, history);
    }
  }

  private async blockFailedPriceEntry(
    ctx: UndoRunContext,
    history: CatalogPriceHistory,
  ): Promise<UndoBatchOutcome> {
    try {
      const next = await this.prisma.$transaction(async (tx) => {
        const options = await this.assertUndoLeaseInTx(tx, ctx);
        this.blockEntity(
          ctx,
          history.catalog_item_id,
          UNDO_BLOCKED_REASONS.ROW_ERROR,
        );
        const progress = this.nextProgress(ctx, 1, history.id, {
          deleted: 0,
          restored: 0,
        });
        await this.persistUndoProgressInTx(tx, ctx, options, progress);
        return progress;
      }, IMPORT_UNDO_BATCH_TX);
      this.advance(ctx, next);
      return 'continue';
    } catch (error) {
      if (error instanceof ImportWorkerLeaseLostError) {
        return 'lease_lost';
      }
      this.logUndoFailure('import.undo.price_block_failed', ctx.jobId, error);
      return 'abort';
    }
  }

  private async applyPricePlan(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    plan: UndoPricePlanItem[],
  ): Promise<number> {
    let restored = 0;
    for (const item of plan) {
      if (!item.action) {
        this.blockEntity(ctx, item.key, item.reason);
        continue;
      }
      await this.restorePriceEntry(tx, ctx, item.history);
      delete ctx.blockedReasons[item.key];
      restored++;
    }
    return restored;
  }

  private async restorePriceEntry(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    history: CatalogPriceHistory,
  ): Promise<void> {
    await tx.catalogItem.updateMany({
      where: { tenant_id: ctx.tenantId, id: history.catalog_item_id },
      data: {
        cost_price: history.old_cost as Prisma.Decimal,
        ...(history.old_retail != null
          ? { retail_price: history.old_retail }
          : {}),
      },
    });
    await this.audit.writeEntityAudit(
      tx,
      ctx.tenantId,
      ctx.actor.userId,
      ctx.jobId,
      'CATALOG_ITEM',
      history.catalog_item_id,
      AuditLogAction.UPDATE,
      { cost_price: history.new_cost, retail_price: history.new_retail },
      { cost_price: history.old_cost, retail_price: history.old_retail },
    );
    await tx.catalogPriceHistory.deleteMany({
      where: { tenant_id: ctx.tenantId, id: history.id },
    });
  }

  /** Blocked entries are keyed, so the same entity is counted once no matter how often it is seen. */
  private blockEntity(ctx: UndoRunContext, key: string, reason?: string): void {
    ctx.blockedReasons[key] = reason ?? UNDO_BLOCKED_REASONS.UNKNOWN;
  }

  private nextProgress(
    ctx: UndoRunContext,
    processedDelta: number,
    cursor: string,
    delta: { deleted: number; restored: number },
  ): UndoProgress {
    return {
      cursor,
      processedRows: ctx.processedRows + processedDelta,
      deleted: ctx.deleted + delta.deleted,
      restored: ctx.restored + delta.restored,
    };
  }

  private advance(ctx: UndoRunContext, next: UndoProgress): void {
    ctx.cursor = next.cursor;
    ctx.processedRows = next.processedRows;
    ctx.deleted = next.deleted;
    ctx.restored = next.restored;
  }

  /**
   * Locks the job row and proves this attempt still owns it. A token-conditioned write is
   * what serialises two overlapping batch transactions; a plain read would not.
   */
  private async assertUndoLeaseInTx(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
  ): Promise<ImportJobOptionsWithUndo> {
    const job = await tx.importJob.findFirst({
      where: { tenant_id: ctx.tenantId, id: ctx.jobId },
      select: { options_json: true },
    });
    const options = (job?.options_json ?? {}) as ImportJobOptionsWithUndo;
    const worker = readUndoWorkerState(options);
    if (!worker) {
      throw new ImportWorkerLeaseLostError(
        `undo lease lost for job ${ctx.jobId} (holder ${undoLeaseHolderPrefix(null)})`,
      );
    }
    const now = Date.now();
    const locked = await tx.importJob.updateMany({
      where: this.undoLeaseWhere(ctx),
      data: {
        options_json: {
          ...options,
          undo_worker: {
            ...worker,
            heartbeat_at: new Date(now).toISOString(),
            lease_until: nextUndoLeaseUntil(now),
          },
        },
      },
    });
    if (locked.count !== 1) {
      throw new ImportWorkerLeaseLostError(
        `undo lease lost for job ${ctx.jobId} (holder ${undoLeaseHolderPrefix(worker.lease_token)})`,
      );
    }
    return options;
  }

  private async persistUndoProgressInTx(
    tx: Prisma.TransactionClient,
    ctx: UndoRunContext,
    options: ImportJobOptionsWithUndo,
    next: UndoProgress,
  ): Promise<void> {
    const now = Date.now();
    const worker = readUndoWorkerState(options) as ImportUndoWorkerState;
    const undoWorker: ImportUndoWorkerState = {
      ...worker,
      cursor: next.cursor,
      processed_rows: next.processedRows,
      deleted_rows: next.deleted,
      restored_rows: next.restored,
      heartbeat_at: new Date(now).toISOString(),
      lease_until: nextUndoLeaseUntil(now),
      blocked_reasons: { ...ctx.blockedReasons },
    };
    const updated = await tx.importJob.updateMany({
      where: this.undoLeaseWhere(ctx),
      data: {
        options_json: {
          ...options,
          undo_worker: undoWorker,
        },
      },
    });
    if (updated.count !== 1) {
      throw new ImportWorkerLeaseLostError(
        `undo lease lost for job ${ctx.jobId} (holder ${undoLeaseHolderPrefix(worker.lease_token)})`,
      );
    }
  }

  private async finalizeUndoJob(ctx: UndoRunContext): Promise<void> {
    const blocked = Object.keys(ctx.blockedReasons).length;
    if (
      blocked === 0 &&
      ctx.deleted + ctx.restored === 0 &&
      ctx.appliedRowsCount > 0
    ) {
      this.blockEntity(
        ctx,
        `job-${ctx.jobId}`,
        UNDO_BLOCKED_REASONS.ROWS_PURGED,
      );
    }
    const outcome: ImportUndoOutcome = {
      status:
        Object.keys(ctx.blockedReasons).length > 0
          ? 'PARTIALLY_UNDONE'
          : 'UNDONE',
      undone_at: new Date().toISOString(),
      deleted: ctx.deleted,
      restored: ctx.restored,
      blocked: Object.keys(ctx.blockedReasons).length,
      blocked_reasons: { ...ctx.blockedReasons },
    };
    const nextStatus =
      outcome.status === 'UNDONE'
        ? ImportJobStatus.UNDONE
        : ImportJobStatus.PARTIALLY_UNDONE;

    try {
      await this.prisma.$transaction(async (tx) => {
        const options = await this.assertUndoLeaseInTx(tx, ctx);
        const nextOptions = { ...options, undo: outcome } as Record<
          string,
          unknown
        >;
        delete nextOptions.undo_worker;
        const updated = await tx.importJob.updateMany({
          where: this.undoLeaseWhere(ctx),
          data: {
            status: nextStatus,
            options_json: nextOptions as Prisma.InputJsonValue,
          },
        });
        if (updated.count !== 1) {
          return;
        }
        await this.audit.writeImportJobUndoAudit(
          tx,
          ctx.tenantId,
          ctx.actor.userId,
          ctx.jobId,
          {
            status: outcome.status,
            deletedCount: outcome.deleted,
            restoredCount: outcome.restored,
            blockedCount: outcome.blocked,
            blockedReasons: outcome.blocked_reasons,
          },
        );
      }, IMPORT_UNDO_BATCH_TX);
    } catch (error) {
      // The new holder finalizes with its own counters, so this attempt just stops. Throwing
      // would only make Cloud Tasks retry a delivery that can never win the lease again.
      if (error instanceof ImportWorkerLeaseLostError) {
        this.logger.warn(
          JSON.stringify({
            event: 'import.undo.lease_lost',
            jobId: ctx.jobId,
            phase: 'finalize',
          }),
        );
        return;
      }
      throw error;
    }
  }

  /** Reclaims UNDOING jobs whose lease expired or whose worker stopped heartbeating. */
  async recoverStaleUndoJobs(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'import-job-undo-recovery',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        for (const { id: tenantId } of tenants) {
          await this.recoverTenantUndoJobs(tenantId);
        }
      },
    );
  }

  private async recoverTenantUndoJobs(tenantId: string): Promise<void> {
    try {
      await this.requestContext.runAsWorker(
        tenantId,
        async () => {
          const jobs = await this.prisma.importJob.findMany({
            where: { status: ImportJobStatus.UNDOING },
            select: { id: true },
            take: 50,
          });
          for (const job of jobs) {
            await this.resumeStaleUndoJob(tenantId, job.id);
          }
        },
        { workerId: 'import-job-undo-recovery' },
      );
    } catch (error) {
      this.logUndoFailure('import.undo.recovery_failed', tenantId, error);
    }
  }

  async resumeStaleUndoJob(tenantId: string, jobId: string): Promise<boolean> {
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    if (!job || job.status !== ImportJobStatus.UNDOING) {
      return false;
    }
    const options = (job.options_json ?? {}) as ImportJobOptionsWithUndo;
    const worker = readUndoWorkerState(options);
    if (!isUndoClaimStale(worker, Date.now())) {
      return false;
    }
    if (!worker) {
      await this.releaseUndoClaim(tenantId, job, options);
      return false;
    }
    const now = Date.now();
    const resumed = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.UNDOING,
        // The snapshot above may be stale: an HTTP takeover can land between the read and
        // this write and owns the token, the overwrite choices and the actor from then on.
        updatedAt: job.updatedAt,
      },
      data: {
        worker_recovery_seq: { increment: 1 },
        options_json: {
          ...options,
          undo_worker: {
            ...worker,
            lease_token: randomUUID(),
            lease_until: UNDO_RELEASED_LEASE_UNTIL,
            heartbeat_at: new Date(now).toISOString(),
          },
        },
      },
    });
    if (resumed.count === 0) {
      return false;
    }
    await this.dispatchUndo(tenantId, jobId, {
      chunkSeq: worker.processed_rows,
      claimSeq: job.worker_claim_seq,
      recoverySeq: job.worker_recovery_seq + 1,
    });
    return true;
  }

  /** An UNDOING job without a claim has no actor to continue with, so it goes back to a resumable status. */
  private async releaseUndoClaim(
    tenantId: string,
    job: ImportJob,
    options: ImportJobOptionsWithUndo,
  ): Promise<void> {
    const resumeStatus = await this.resolveUndoReleaseStatus(
      tenantId,
      job,
      options,
    );
    const released = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: job.id,
        status: ImportJobStatus.UNDOING,
        // An HTTP takeover can land after the snapshot this release was planned from; it then
        // owns the claim and must not be pushed back to a resumable status.
        updatedAt: job.updatedAt,
      },
      data: { status: resumeStatus },
    });
    if (released.count === 0) {
      return;
    }
    this.logger.warn(
      JSON.stringify({
        event: 'import.undo.claim_released',
        jobId: job.id,
        resumeStatus,
      }),
    );
  }

  /** Rows already undone make the job partially undone, whatever status it was claimed from. */
  private async resolveUndoReleaseStatus(
    tenantId: string,
    job: ImportJob,
    options: ImportJobOptionsWithUndo,
  ): Promise<ImportJobStatus> {
    const undoneRows = await this.prisma.importJobRow.count({
      where: {
        tenant_id: tenantId,
        import_job_id: job.id,
        undone_at: { not: null },
      },
    });
    if (undoneRows > 0) {
      return ImportJobStatus.PARTIALLY_UNDONE;
    }
    return (
      (options.undo_worker?.resume_status as ImportJobStatus) ??
      ImportJobStatus.PARTIALLY_UNDONE
    );
  }

  private serialize(job: ImportJob): SerializedImportJob {
    return serializeImportJob(job, (job.totals_json ?? {}) as ImportJobTotals);
  }
}

/** A takeover invalidates the previous holder's token and waits for its own worker. */
function renewUndoClaim(
  worker: ImportUndoWorkerState,
  params: { confirmedEntityIds: string[] },
): ImportUndoWorkerState {
  const now = Date.now();
  return {
    ...worker,
    lease_token: randomUUID(),
    lease_until: UNDO_RELEASED_LEASE_UNTIL,
    heartbeat_at: new Date(now).toISOString(),
    confirmed_entity_ids: params.confirmedEntityIds,
  };
}
