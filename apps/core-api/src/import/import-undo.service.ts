import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditLogAction,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { ImportAuditWriter } from './import-audit.writer.js';
import { checkEntityUndoEligibility } from './import-undo.guard.js';
import type { UndoImportJobDto } from './dto/undo-import-job.dto.js';
import type { ImportJobTotals } from './import.types.js';

const UNDO_BATCH_SIZE = 100;

@Injectable()
export class ImportUndoService {
  private readonly audit: ImportAuditWriter;

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {
    this.audit = new ImportAuditWriter(tenantContext);
  }

  async undoJob(jobId: string, dto?: UndoImportJobDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const authUser = this.tenantContext.getAuthenticatedUser();
    const actorUserId = authUser?.userId ?? 'system';

    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    // Idempotent: already undone
    if (job.status === ImportJobStatus.UNDONE) {
      return job;
    }

    const totals = job.totals_json as ImportJobTotals | null;
    const appliedRowsCount = (totals?.create ?? 0) + (totals?.update ?? 0);

    const isUndoableStatus =
      job.status === ImportJobStatus.APPLIED ||
      job.status === ImportJobStatus.PARTIALLY_UNDONE ||
      (job.status === ImportJobStatus.FAILED && appliedRowsCount > 0);

    if (!isUndoableStatus) {
      throw new BadRequestException(
        'Import job is not in an undoable state (must be APPLIED, PARTIALLY_UNDONE, or FAILED with applied rows)',
      );
    }

    if (
      job.entity_type === 'LEGACY_INVOICE' ||
      job.entity_type === 'LEGACY_SERVICE_ORDER' ||
      job.entity_type === 'STOCK_OPENING_BALANCE' ||
      job.entity_type === 'OPEN_WORKSHOP_ORDER'
    ) {
      throw new BadRequestException(
        'Financial and document imports cannot be undone',
      );
    }

    const confirmedSet = new Set(dto?.confirmedEntityIds ?? []);

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        let deletedCount = 0;
        let restoredCount = 0;
        let blockedCount = 0;
        const blockedReasons: Record<string, string> = {};

        const effectiveAppliedAt = job.appliedAt ?? job.updatedAt;

        // Special handling for SUPPLIER_PRICE_LIST price updates
        if (job.entity_type === 'SUPPLIER_PRICE_LIST') {
          const priceHistories = await tx.catalogPriceHistory.findMany({
            where: { tenant_id: tenantId, import_job_id: jobId },
          });

          for (const history of priceHistories) {
            const eligibility = await checkEntityUndoEligibility(
              tx,
              tenantId,
              'CATALOG_ITEM',
              history.catalog_item_id,
              effectiveAppliedAt,
            );

            const isConfirmed = confirmedSet.has(history.catalog_item_id);
            if (
              eligibility.status === 'BLOCKED' ||
              (eligibility.status === 'CONFLICT' && !isConfirmed)
            ) {
              blockedCount++;
              if (eligibility.reason) {
                blockedReasons[history.catalog_item_id] = eligibility.reason;
              }
            } else {
              await tx.catalogItem.updateMany({
                where: { tenant_id: tenantId, id: history.catalog_item_id },
                data: {
                  cost_price: history.old_cost,
                  retail_price: history.old_retail ?? 0,
                },
              });
              await this.audit.writeEntityAudit(
                tx,
                tenantId,
                actorUserId,
                jobId,
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
              restoredCount++;
            }
          }

          if (blockedCount === 0) {
            await tx.catalogPriceHistory.deleteMany({
              where: { tenant_id: tenantId, import_job_id: jobId },
            });
          }
        }

        // Process import_job_rows in batches
        const rows = await tx.importJobRow.findMany({
          where: {
            tenant_id: tenantId,
            import_job_id: jobId,
            action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
          },
          orderBy: { row_no: 'asc' },
        });

        for (let i = 0; i < rows.length; i += UNDO_BATCH_SIZE) {
          const batch = rows.slice(i, i + UNDO_BATCH_SIZE);

          for (const row of batch) {
            if (!row.entity_id) {
              continue;
            }

            const eligibility = await checkEntityUndoEligibility(
              tx,
              tenantId,
              job.entity_type,
              row.entity_id,
              effectiveAppliedAt,
            );

            const isConfirmed = confirmedSet.has(row.entity_id);
            if (
              eligibility.status === 'BLOCKED' ||
              (eligibility.status === 'CONFLICT' && !isConfirmed)
            ) {
              blockedCount++;
              if (eligibility.reason) {
                blockedReasons[row.entity_id] = eligibility.reason;
              }
              continue;
            }

            if (row.action === ImportRowAction.CREATE) {
              await this.deleteCreatedEntity(
                tx,
                tenantId,
                job.entity_type,
                row.entity_id,
                jobId,
              );
              await this.audit.writeEntityAudit(
                tx,
                tenantId,
                actorUserId,
                jobId,
                job.entity_type,
                row.entity_id,
                AuditLogAction.DELETE,
                row.normalized_json,
                null,
              );
              deletedCount++;
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
                tenantId,
                job.entity_type,
                row.entity_id,
                beforeSnapshot,
              );
              await this.audit.writeEntityAudit(
                tx,
                tenantId,
                actorUserId,
                jobId,
                job.entity_type,
                row.entity_id,
                AuditLogAction.UPDATE,
                row.normalized_json,
                beforeSnapshot,
              );
              restoredCount++;
            }
          }
        }

        const nextStatus =
          blockedCount > 0
            ? ImportJobStatus.PARTIALLY_UNDONE
            : ImportJobStatus.UNDONE;

        const updatedOptions = {
          ...(typeof job.options_json === 'object' && job.options_json !== null
            ? (job.options_json as Record<string, unknown>)
            : {}),
          undo: {
            undoneAt: new Date().toISOString(),
            status: nextStatus,
            deletedCount,
            restoredCount,
            blockedCount,
            blockedReasons,
          },
        };

        await this.audit.writeImportJobUndoAudit(
          tx,
          tenantId,
          actorUserId,
          jobId,
          {
            status: nextStatus,
            deletedCount,
            restoredCount,
            blockedCount,
            blockedReasons,
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
    switch (entityType) {
      case 'CUSTOMER':
        await tx.customer.updateMany({
          where: { tenant_id: tenantId, id: entityId },
          data: snapshot,
        });
        break;
      case 'VEHICLE': {
        const vehicleData = {
          ...snapshot,
          first_registration_date: snapshot.first_registration_date
            ? new Date(snapshot.first_registration_date as string)
            : null,
        } as Prisma.VehicleUpdateManyMutationInput;
        await tx.vehicle.updateMany({
          where: { tenant_id: tenantId, id: entityId },
          data: vehicleData,
        });
        break;
      }
      case 'LABOR_OPERATION':
        await tx.laborOperation.updateMany({
          where: { tenant_id: tenantId, id: entityId },
          data: snapshot,
        });
        break;
      case 'VEHICLE_PARTY': {
        const partyData = {
          ...snapshot,
          valid_from: snapshot.valid_from
            ? new Date(snapshot.valid_from as string)
            : null,
          valid_to: snapshot.valid_to
            ? new Date(snapshot.valid_to as string)
            : null,
        } as Prisma.VehiclePartyUpdateManyMutationInput;
        await tx.vehicleParty.updateMany({
          where: { tenant_id: tenantId, id: entityId },
          data: partyData,
        });
        break;
      }
      case 'VEHICLE_NOTICE': {
        const noticeData = {
          ...snapshot,
          due_date: snapshot.due_date
            ? new Date(snapshot.due_date as string)
            : null,
        } as Prisma.VehicleNoticeUpdateManyMutationInput;
        await tx.vehicleNotice.updateMany({
          where: { tenant_id: tenantId, id: entityId },
          data: noticeData,
        });
        break;
      }
    }
  }
}
