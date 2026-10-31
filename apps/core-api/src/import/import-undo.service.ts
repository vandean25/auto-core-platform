import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditLogAction,
  ImportJob,
  ImportJobRow,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { withPhoneDigits } from '../customer/customer-phone.util.js';
import { ImportAuditWriter } from './import-audit.writer.js';
import {
  checkEntityUndoEligibility,
  isDocOrFinancialImport,
  isUndoSupportedEntityType,
} from './import-undo.guard.js';
import { UNDO_BLOCKED_REASONS } from './import-undo.types.js';
import { UndoImportJobDto } from './dto/undo-import-job.dto.js';
import type { ImportJobTotals } from './import.types.js';

export const UNDO_BATCH_SIZE = 50;

const UNDOABLE_STATUSES = new Set<ImportJobStatus>([
  ImportJobStatus.APPLIED,
  ImportJobStatus.PARTIALLY_UNDONE,
]);

function getAppliedRowsCount(totals: ImportJobTotals | null): number {
  if (!totals) return 0;
  return (totals.create || 0) + (totals.update || 0);
}

function validateJobForUndo(
  job: ImportJob | null,
  jobId: string,
): { appliedRowsCount: number } {
  if (!job) {
    throw new NotFoundException(`Import job ${jobId} not found`);
  }

  const appliedRowsCount = getAppliedRowsCount(
    job.totals_json as ImportJobTotals | null,
  );

  const isUndoableStatus =
    UNDOABLE_STATUSES.has(job.status) ||
    (job.status === ImportJobStatus.FAILED && appliedRowsCount > 0);

  if (!isUndoableStatus) {
    throw new BadRequestException(
      'Import job is not in an undoable state (must be APPLIED, PARTIALLY_UNDONE, or FAILED with applied rows)',
    );
  }

  if (isDocOrFinancialImport(job.entity_type)) {
    throw new BadRequestException(
      'Financial and document imports cannot be undone',
    );
  }

  return { appliedRowsCount };
}

interface UndoExecutionContext {
  tenantId: string;
  actorUserId: string;
  jobId: string;
  entityType: string;
  effectiveAppliedAt: Date;
}

interface UndoCounts {
  deletedCount: number;
  restoredCount: number;
  blockedCount: number;
  blockedReasons: Record<string, string>;
}

function parseDateOrNull(val: unknown): Date | null {
  return val ? new Date(val as string) : null;
}

type EntityRestorer = (
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityId: string,
  snapshot: Record<string, unknown>,
) => Promise<unknown>;

const ENTITY_RESTORERS: Record<string, EntityRestorer> = {
  CUSTOMER: (tx, tenantId, id, data) =>
    tx.customer.updateMany({
      where: { tenant_id: tenantId, id },
      data: withPhoneDigits(data as Prisma.CustomerUpdateManyMutationInput),
    }),
  VEHICLE: (tx, tenantId, id, data) =>
    tx.vehicle.updateMany({
      where: { tenant_id: tenantId, id },
      data: {
        ...data,
        first_registration_date: parseDateOrNull(data.first_registration_date),
      },
    }),
  LABOR_OPERATION: (tx, tenantId, id, data) =>
    tx.laborOperation.updateMany({
      where: { tenant_id: tenantId, id },
      data,
    }),
  VEHICLE_PARTY: (tx, tenantId, id, data) =>
    tx.vehicleParty.updateMany({
      where: { tenant_id: tenantId, id },
      data: {
        ...data,
        valid_from: parseDateOrNull(data.valid_from),
        valid_to: parseDateOrNull(data.valid_to),
      },
    }),
  VEHICLE_NOTICE: (tx, tenantId, id, data) =>
    tx.vehicleNotice.updateMany({
      where: { tenant_id: tenantId, id },
      data: {
        ...data,
        due_date: parseDateOrNull(data.due_date),
      },
    }),
};

@Injectable()
export class ImportUndoService {
  private readonly audit: ImportAuditWriter;

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {
    this.audit = new ImportAuditWriter(tenantContext);
  }

  private async fetchAndValidateJobForUndo(
    tenantId: string,
    jobId: string,
  ): Promise<ImportJob> {
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    if (job.status === ImportJobStatus.UNDONE) {
      return job;
    }

    if (
      job.status === ImportJobStatus.UNDOING ||
      job.status === ImportJobStatus.APPLYING
    ) {
      throw new ConflictException({
        code: 'IMPORT_JOB_BUSY',
        message: 'Import job is currently being processed',
      });
    }

    validateJobForUndo(job, jobId);
    return job;
  }

  private async claimJobForUndo(
    tenantId: string,
    jobId: string,
    updatedAt: Date,
  ): Promise<void> {
    const claim = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: {
          in: [
            ImportJobStatus.APPLIED,
            ImportJobStatus.PARTIALLY_UNDONE,
            ImportJobStatus.FAILED,
          ],
        },
        updatedAt,
      },
      data: {
        status: ImportJobStatus.UNDOING,
      },
    });

    if (claim.count === 0) {
      throw new ConflictException({
        code: 'IMPORT_JOB_CONFLICT',
        message: 'Import job was modified or claimed concurrently',
      });
    }
  }

  private async finalizeUndoJob(
    tenantId: string,
    jobId: string,
    job: ImportJob,
    counts: UndoCounts,
    actorUserId: string,
  ): Promise<ImportJob> {
    const nextStatus =
      counts.blockedCount > 0
        ? ImportJobStatus.PARTIALLY_UNDONE
        : ImportJobStatus.UNDONE;

    const updatedOptions = {
      ...(typeof job.options_json === 'object' && job.options_json !== null
        ? (job.options_json as Record<string, unknown>)
        : {}),
      undo: {
        undoneAt: new Date().toISOString(),
        status: nextStatus,
        deletedCount: counts.deletedCount,
        restoredCount: counts.restoredCount,
        blockedCount: counts.blockedCount,
        blockedReasons: counts.blockedReasons,
      },
    };

    await this.audit.writeImportJobUndoAudit(
      this.prisma,
      tenantId,
      actorUserId,
      jobId,
      {
        status: nextStatus,
        deletedCount: counts.deletedCount,
        restoredCount: counts.restoredCount,
        blockedCount: counts.blockedCount,
        blockedReasons: counts.blockedReasons,
      },
    );

    await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.UNDOING,
      },
      data: {
        status: nextStatus,
        options_json: updatedOptions,
      },
    });

    return await this.prisma.importJob.findFirstOrThrow({
      where: { tenant_id: tenantId, id: jobId },
    });
  }

  async undoJob(jobId: string, dto?: UndoImportJobDto): Promise<ImportJob> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const authUser = this.tenantContext.getAuthenticatedUser();

    const job = await this.fetchAndValidateJobForUndo(tenantId, jobId);
    if (job.status === ImportJobStatus.UNDONE) {
      return job;
    }

    await this.claimJobForUndo(tenantId, jobId, job.updatedAt);

    const actorUserId = authUser?.userId ?? (job.created_by || 'system');
    const confirmedSet = new Set(dto?.confirmedEntityIds ?? []);

    const execContext: UndoExecutionContext = {
      tenantId,
      actorUserId,
      jobId,
      entityType: job.entity_type,
      effectiveAppliedAt: job.appliedAt ?? job.updatedAt,
    };

    const counts: UndoCounts = {
      deletedCount: 0,
      restoredCount: 0,
      blockedCount: 0,
      blockedReasons: {},
    };

    if (job.entity_type === 'SUPPLIER_PRICE_LIST') {
      await this.undoSupplierPriceList(execContext, confirmedSet, counts);
    } else {
      await this.processJobBatches(execContext, confirmedSet, counts);
    }

    return await this.finalizeUndoJob(
      tenantId,
      jobId,
      job,
      counts,
      actorUserId,
    );
  }

  private async undoSupplierPriceList(
    ctx: UndoExecutionContext,
    confirmedSet: Set<string>,
    counts: UndoCounts,
  ): Promise<void> {
    while (true) {
      const priceHistories = await this.prisma.catalogPriceHistory.findMany({
        where: { tenant_id: ctx.tenantId, import_job_id: ctx.jobId },
        take: UNDO_BATCH_SIZE,
      });

      if (priceHistories.length === 0) {
        break;
      }

      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const history of priceHistories) {
          const eligibility = await checkEntityUndoEligibility(
            tx,
            ctx.tenantId,
            'CATALOG_ITEM',
            history.catalog_item_id,
            ctx.effectiveAppliedAt,
          );

          const isConfirmed = confirmedSet.has(history.catalog_item_id);
          if (
            eligibility.status === 'BLOCKED' ||
            (eligibility.status === 'CONFLICT' && !isConfirmed)
          ) {
            counts.blockedCount++;
            if (eligibility.reason) {
              counts.blockedReasons[history.catalog_item_id] =
                eligibility.reason;
            }
          } else {
            await tx.catalogItem.updateMany({
              where: { tenant_id: ctx.tenantId, id: history.catalog_item_id },
              data: {
                cost_price: history.old_cost,
                ...(history.old_retail != null
                  ? { retail_price: history.old_retail }
                  : {}),
              },
            });
            await this.audit.writeEntityAudit(
              tx,
              ctx.tenantId,
              ctx.actorUserId,
              ctx.jobId,
              'CATALOG_ITEM',
              history.catalog_item_id,
              AuditLogAction.UPDATE,
              {
                cost_price: history.new_cost,
                retail_price: history.new_retail,
              },
              {
                cost_price: history.old_cost,
                retail_price: history.old_retail,
              },
            );
            // Delete this specific CatalogPriceHistory entry so partial undo remains consistent
            await tx.catalogPriceHistory.delete({
              where: { id: history.id },
            });
            counts.restoredCount++;
          }
        }
      });

      // Break if all remaining rows in this batch were blocked to prevent infinite loop
      if (
        priceHistories.every((h) => counts.blockedReasons[h.catalog_item_id])
      ) {
        break;
      }
    }
  }

  private async processJobBatches(
    ctx: UndoExecutionContext,
    confirmedSet: Set<string>,
    counts: UndoCounts,
  ): Promise<void> {
    let cursor = 0;
    while (true) {
      const rows = await this.prisma.importJobRow.findMany({
        where: {
          tenant_id: ctx.tenantId,
          import_job_id: ctx.jobId,
          action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
          row_no: { gt: cursor },
        },
        orderBy: { row_no: 'asc' },
        take: UNDO_BATCH_SIZE,
      });

      if (rows.length === 0) {
        break;
      }
      cursor = rows[rows.length - 1].row_no;

      // Filter out rows that are already marked undone
      const pendingRows = rows.filter((r) => !r.undone_at);
      if (pendingRows.length === 0) {
        continue;
      }

      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const row of pendingRows) {
          try {
            await this.processSingleRow(tx, row, ctx, confirmedSet, counts);
          } catch (rowError) {
            // Per-row error handling: record as blocked instead of aborting whole batch
            counts.blockedCount++;
            const reason =
              rowError instanceof Error ? rowError.message : String(rowError);
            counts.blockedReasons[row.entity_id ?? `row-${row.row_no}`] =
              `ROW_ERROR: ${reason}`;
          }
        }
      });
    }
  }

  private getRowStaticBlockReason(
    row: ImportJobRow,
    entityType: string,
  ): string | null {
    if (!row.entity_id) {
      return UNDO_BLOCKED_REASONS.UNKNOWN;
    }
    if (row.action === ImportRowAction.UPDATE && !row.before_snapshot_json) {
      return UNDO_BLOCKED_REASONS.MISSING_BEFORE_SNAPSHOT;
    }
    if (
      !isUndoSupportedEntityType(entityType) ||
      (row.action === ImportRowAction.UPDATE && !ENTITY_RESTORERS[entityType])
    ) {
      return UNDO_BLOCKED_REASONS.UNSUPPORTED_ENTITY_TYPE;
    }
    return null;
  }

  private async executeRowDelete(
    tx: Prisma.TransactionClient,
    row: ImportJobRow,
    ctx: UndoExecutionContext,
    currentEntity: unknown,
    counts: UndoCounts,
  ): Promise<void> {
    const entityId = row.entity_id!;
    await this.deleteCreatedEntity(
      tx,
      ctx.tenantId,
      ctx.entityType,
      entityId,
      ctx.jobId,
    );
    await this.audit.writeEntityAudit(
      tx,
      ctx.tenantId,
      ctx.actorUserId,
      ctx.jobId,
      ctx.entityType,
      entityId,
      AuditLogAction.DELETE,
      currentEntity ?? row.normalized_json,
      null,
    );
    await tx.importJobRow.update({
      where: {
        tenant_id_import_job_id_row_no: {
          tenant_id: ctx.tenantId,
          import_job_id: ctx.jobId,
          row_no: row.row_no,
        },
      },
      data: { undone_at: new Date() },
    });
    counts.deletedCount++;
  }

  private async executeRowRestore(
    tx: Prisma.TransactionClient,
    row: ImportJobRow,
    ctx: UndoExecutionContext,
    currentEntity: unknown,
    counts: UndoCounts,
  ): Promise<void> {
    const entityId = row.entity_id!;
    const beforeSnapshot = row.before_snapshot_json as Record<string, unknown>;
    await this.restoreUpdatedEntity(
      tx,
      ctx.tenantId,
      ctx.entityType,
      entityId,
      beforeSnapshot,
    );
    await this.audit.writeEntityAudit(
      tx,
      ctx.tenantId,
      ctx.actorUserId,
      ctx.jobId,
      ctx.entityType,
      entityId,
      AuditLogAction.UPDATE,
      currentEntity ?? row.normalized_json,
      beforeSnapshot,
    );
    await tx.importJobRow.update({
      where: {
        tenant_id_import_job_id_row_no: {
          tenant_id: ctx.tenantId,
          import_job_id: ctx.jobId,
          row_no: row.row_no,
        },
      },
      data: { undone_at: new Date() },
    });
    counts.restoredCount++;
  }

  private async processSingleRow(
    tx: Prisma.TransactionClient,
    row: ImportJobRow,
    ctx: UndoExecutionContext,
    confirmedSet: Set<string>,
    counts: UndoCounts,
  ): Promise<void> {
    const staticReason = this.getRowStaticBlockReason(row, ctx.entityType);
    if (staticReason) {
      counts.blockedCount++;
      const key = row.entity_id ?? `row-${row.row_no}`;
      counts.blockedReasons[key] = staticReason;
      return;
    }

    const eligibility = await checkEntityUndoEligibility(
      tx,
      ctx.tenantId,
      ctx.entityType,
      row.entity_id!,
      ctx.effectiveAppliedAt,
    );

    const isConfirmed = confirmedSet.has(row.entity_id!);
    if (
      eligibility.status === 'BLOCKED' ||
      (eligibility.status === 'CONFLICT' && !isConfirmed)
    ) {
      counts.blockedCount++;
      if (eligibility.reason) {
        counts.blockedReasons[row.entity_id!] = eligibility.reason;
      }
      return;
    }

    if (row.action === ImportRowAction.CREATE) {
      await this.executeRowDelete(tx, row, ctx, eligibility.entity, counts);
    } else if (
      row.action === ImportRowAction.UPDATE &&
      row.before_snapshot_json
    ) {
      await this.executeRowRestore(tx, row, ctx, eligibility.entity, counts);
    }
  }

  private async deleteCreatedEntity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entityType: string,
    entityId: string,
    jobId: string,
  ): Promise<void> {
    await tx.externalIdMapping.deleteMany({
      where: {
        tenant_id: tenantId,
        first_seen_import_job_id: jobId,
        entity_id: entityId,
      },
    });

    switch (entityType) {
      case 'CUSTOMER':
        await tx.customerConsentUnsubscribeToken.deleteMany({
          where: { tenant_id: tenantId, customer_id: entityId },
        });
        await tx.customerCommunicationState.deleteMany({
          where: { tenant_id: tenantId, customer_id: entityId },
        });
        await tx.customer.deleteMany({
          where: { tenant_id: tenantId, id: entityId },
        });
        break;
      case 'VEHICLE':
        await tx.vehicle.deleteMany({
          where: { tenant_id: tenantId, id: entityId },
        });
        break;
      case 'LABOR_OPERATION':
        await tx.laborOperation.deleteMany({
          where: { tenant_id: tenantId, id: entityId },
        });
        break;
      case 'CATALOG_ITEM':
        await tx.catalogPriceHistory.deleteMany({
          where: { tenant_id: tenantId, catalog_item_id: entityId },
        });
        await tx.vendorArticle.deleteMany({
          where: { tenant_id: tenantId, catalog_item_id: entityId },
        });
        await tx.catalogItem.deleteMany({
          where: { tenant_id: tenantId, id: entityId },
        });
        break;
      case 'VEHICLE_PARTY':
        await tx.vehicleParty.deleteMany({
          where: { tenant_id: tenantId, id: entityId },
        });
        break;
      case 'VEHICLE_NOTICE':
        await tx.vehicleNotice.deleteMany({
          where: { tenant_id: tenantId, id: entityId },
        });
        break;
      default:
        throw new BadRequestException(
          `Unsupported entity type for delete: ${entityType}`,
        );
    }
  }

  private async restoreUpdatedEntity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entityType: string,
    entityId: string,
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    const restorer = ENTITY_RESTORERS[entityType];
    if (restorer) {
      await restorer(tx, tenantId, entityId, snapshot);
    }
  }
}
