import {
  BadRequestException,
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
import { ImportAuditWriter } from './import-audit.writer.js';
import {
  checkEntityUndoEligibility,
  isDocOrFinancialImport,
} from './import-undo.guard.js';
import { UndoImportJobDto } from './dto/undo-import-job.dto.js';
import type { ImportJobTotals } from './import.types.js';

const UNDO_BATCH_SIZE = 50;

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
      data,
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

  async undoJob(jobId: string, dto?: UndoImportJobDto): Promise<ImportJob> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const authUser = this.tenantContext.getAuthenticatedUser();
    const actorUserId = authUser?.userId ?? 'system';

    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });

    if (job?.status === ImportJobStatus.UNDONE) {
      return job;
    }

    validateJobForUndo(job, jobId);
    const confirmedSet = new Set(dto?.confirmedEntityIds ?? []);

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const execContext: UndoExecutionContext = {
          tenantId,
          actorUserId,
          jobId,
          entityType: job!.entity_type,
          effectiveAppliedAt: job!.appliedAt ?? job!.updatedAt,
        };

        const counts: UndoCounts = {
          deletedCount: 0,
          restoredCount: 0,
          blockedCount: 0,
          blockedReasons: {},
        };

        if (job!.entity_type === 'SUPPLIER_PRICE_LIST') {
          await this.undoSupplierPriceList(
            tx,
            execContext,
            confirmedSet,
            counts,
          );
        }

        await this.processJobRows(tx, execContext, confirmedSet, counts);

        const nextStatus =
          counts.blockedCount > 0
            ? ImportJobStatus.PARTIALLY_UNDONE
            : ImportJobStatus.UNDONE;

        const updatedOptions = {
          ...(typeof job!.options_json === 'object' &&
          job!.options_json !== null
            ? (job!.options_json as Record<string, unknown>)
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
          tx,
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

        return await tx.importJob.update({
          where: { tenant_id_id: { tenant_id: tenantId, id: jobId } },
          data: {
            status: nextStatus,
            options_json: updatedOptions,
          },
        });
      },
    );
  }

  private async undoSupplierPriceList(
    tx: Prisma.TransactionClient,
    ctx: UndoExecutionContext,
    confirmedSet: Set<string>,
    counts: UndoCounts,
  ): Promise<void> {
    const priceHistories = await tx.catalogPriceHistory.findMany({
      where: { tenant_id: ctx.tenantId, import_job_id: ctx.jobId },
    });

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
          counts.blockedReasons[history.catalog_item_id] = eligibility.reason;
        }
      } else {
        await tx.catalogItem.updateMany({
          where: { tenant_id: ctx.tenantId, id: history.catalog_item_id },
          data: {
            cost_price: history.old_cost,
            retail_price: history.old_retail ?? 0,
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
        counts.restoredCount++;
      }
    }

    if (counts.blockedCount === 0) {
      await tx.catalogPriceHistory.deleteMany({
        where: { tenant_id: ctx.tenantId, import_job_id: ctx.jobId },
      });
    }
  }

  private async processJobRows(
    tx: Prisma.TransactionClient,
    ctx: UndoExecutionContext,
    confirmedSet: Set<string>,
    counts: UndoCounts,
  ): Promise<void> {
    const rows = await tx.importJobRow.findMany({
      where: {
        tenant_id: ctx.tenantId,
        import_job_id: ctx.jobId,
        action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
      },
      orderBy: { row_no: 'asc' },
    });

    for (let i = 0; i < rows.length; i += UNDO_BATCH_SIZE) {
      const batch = rows.slice(i, i + UNDO_BATCH_SIZE);
      for (const row of batch) {
        await this.processSingleRow(tx, row, ctx, confirmedSet, counts);
      }
    }
  }

  private async processSingleRow(
    tx: Prisma.TransactionClient,
    row: ImportJobRow,
    ctx: UndoExecutionContext,
    confirmedSet: Set<string>,
    counts: UndoCounts,
  ): Promise<void> {
    if (!row.entity_id) return;

    const eligibility = await checkEntityUndoEligibility(
      tx,
      ctx.tenantId,
      ctx.entityType,
      row.entity_id,
      ctx.effectiveAppliedAt,
    );

    const isConfirmed = confirmedSet.has(row.entity_id);
    if (
      eligibility.status === 'BLOCKED' ||
      (eligibility.status === 'CONFLICT' && !isConfirmed)
    ) {
      counts.blockedCount++;
      if (eligibility.reason) {
        counts.blockedReasons[row.entity_id] = eligibility.reason;
      }
      return;
    }

    if (row.action === ImportRowAction.CREATE) {
      await this.deleteCreatedEntity(
        tx,
        ctx.tenantId,
        ctx.entityType,
        row.entity_id,
        ctx.jobId,
      );
      await this.audit.writeEntityAudit(
        tx,
        ctx.tenantId,
        ctx.actorUserId,
        ctx.jobId,
        ctx.entityType,
        row.entity_id,
        AuditLogAction.DELETE,
        row.normalized_json,
        null,
      );
      counts.deletedCount++;
    } else if (
      row.action === ImportRowAction.UPDATE &&
      row.before_snapshot_json
    ) {
      const beforeSnapshot = row.before_snapshot_json as Record<
        string,
        unknown
      >;
      await this.restoreUpdatedEntity(
        tx,
        ctx.tenantId,
        ctx.entityType,
        row.entity_id,
        beforeSnapshot,
      );
      await this.audit.writeEntityAudit(
        tx,
        ctx.tenantId,
        ctx.actorUserId,
        ctx.jobId,
        ctx.entityType,
        row.entity_id,
        AuditLogAction.UPDATE,
        row.normalized_json,
        beforeSnapshot,
      );
      counts.restoredCount++;
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
      case 'SUPPLIER_PRICE_LIST':
        await tx.catalogPriceHistory.deleteMany({
          where: { tenant_id: tenantId, import_job_id: jobId },
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
