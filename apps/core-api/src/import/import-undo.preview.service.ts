import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import {
  ImportUndoCountsDto,
  ImportUndoPreviewResponseDto,
  ImportUndoRowPreviewDto,
} from './dto/undo-import-preview-response.dto.js';
import { checkEntityUndoEligibility } from './import-undo.guard.js';
import type { ImportJobTotals } from './import.types.js';

@Injectable()
export class ImportUndoPreviewService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async previewUndo(jobId: string): Promise<ImportUndoPreviewResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    if (job.status === ImportJobStatus.UNDONE) {
      throw new BadRequestException('IMPORT_JOB_ALREADY_UNDONE');
    }

    const totals = job.totals_json as ImportJobTotals | null;
    const appliedRowsCount = (totals?.create ?? 0) + (totals?.update ?? 0);

    const isEligibleStatus =
      job.status === ImportJobStatus.APPLIED ||
      (job.status === ImportJobStatus.FAILED && appliedRowsCount > 0);

    if (!isEligibleStatus) {
      throw new BadRequestException(
        'Import job is not in an undoable state (must be APPLIED or FAILED with applied rows)',
      );
    }

    // Financial or document imports cannot be undone
    if (
      job.entity_type === 'LEGACY_INVOICE' ||
      job.entity_type === 'LEGACY_SERVICE_ORDER' ||
      job.entity_type === 'STOCK_OPENING_BALANCE' ||
      job.entity_type === 'OPEN_WORKSHOP_ORDER'
    ) {
      return {
        jobId,
        status: 'BLOCKED',
        canUndo: false,
        counts: {
          total: appliedRowsCount,
          toDelete: 0,
          toRestore: 0,
          conflicts: 0,
          blocked: appliedRowsCount,
        },
        deletions: [],
        restorations: [],
        conflicts: [],
        blocked: [
          {
            rowNumber: 0,
            entityType: job.entity_type,
            entityId: null,
            action: 'CREATE',
            status: 'BLOCKED',
            reason: 'Financial and document imports cannot be undone',
          },
        ],
      };
    }

    const appliedRows = await this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
      },
      orderBy: { row_no: 'asc' },
    });

    const deletions: ImportUndoRowPreviewDto[] = [];
    const restorations: ImportUndoRowPreviewDto[] = [];
    const conflicts: ImportUndoRowPreviewDto[] = [];
    const blocked: ImportUndoRowPreviewDto[] = [];

    const effectiveAppliedAt = job.appliedAt ?? job.updatedAt;

    for (const row of appliedRows) {
      const payload = row.normalized_json as Record<string, unknown> | null;
      const displayName = this.resolveDisplayName(payload);
      const action =
        row.action === ImportRowAction.CREATE ? 'CREATE' : 'UPDATE';

      if (!row.entity_id) {
        // Unsaved or missing entity
        continue;
      }

      const eligibility = await checkEntityUndoEligibility(
        this.prisma,
        tenantId,
        job.entity_type,
        row.entity_id,
        effectiveAppliedAt,
      );

      const rowPreview: ImportUndoRowPreviewDto = {
        rowNumber: row.row_no,
        entityType: job.entity_type,
        entityId: row.entity_id,
        action,
        status: eligibility.status,
        reason: eligibility.reason,
        references: eligibility.references,
        displayName,
      };

      if (eligibility.status === 'BLOCKED') {
        blocked.push(rowPreview);
      } else if (eligibility.status === 'CONFLICT') {
        conflicts.push(rowPreview);
      } else if (action === 'CREATE') {
        deletions.push(rowPreview);
      } else {
        restorations.push(rowPreview);
      }
    }

    const counts: ImportUndoCountsDto = {
      total:
        deletions.length +
        restorations.length +
        conflicts.length +
        blocked.length,
      toDelete: deletions.length,
      toRestore: restorations.length,
      conflicts: conflicts.length,
      blocked: blocked.length,
    };

    let overallStatus: 'ELIGIBLE' | 'CONFLICT' | 'BLOCKED' = 'ELIGIBLE';
    if (
      counts.blocked > 0 &&
      counts.toDelete === 0 &&
      counts.toRestore === 0 &&
      counts.conflicts === 0
    ) {
      overallStatus = 'BLOCKED';
    } else if (counts.conflicts > 0) {
      overallStatus = 'CONFLICT';
    }

    const canUndo =
      counts.toDelete > 0 || counts.toRestore > 0 || counts.conflicts > 0;

    return {
      jobId,
      status: overallStatus,
      canUndo,
      counts,
      deletions,
      restorations,
      conflicts,
      blocked,
    };
  }

  private resolveDisplayName(
    payload?: Record<string, unknown> | null,
  ): string | undefined {
    if (!payload) return undefined;
    if (
      typeof payload.first_name === 'string' ||
      typeof payload.last_name === 'string'
    ) {
      const parts = [payload.first_name, payload.last_name].filter(
        (part): part is string =>
          typeof part === 'string' && part.trim().length > 0,
      );
      if (parts.length > 0) return parts.join(' ');
    }
    if (
      typeof payload.company_name === 'string' &&
      payload.company_name.trim()
    ) {
      return payload.company_name.trim();
    }
    if (typeof payload.make === 'string' || typeof payload.model === 'string') {
      const parts = [payload.make, payload.model].filter(
        (part): part is string =>
          typeof part === 'string' && part.trim().length > 0,
      );
      if (parts.length > 0) return parts.join(' ');
    }
    if (
      typeof payload.code === 'string' ||
      typeof payload.description === 'string'
    ) {
      const parts = [payload.code, payload.description].filter(
        (part): part is string =>
          typeof part === 'string' && part.trim().length > 0,
      );
      if (parts.length > 0) return parts.join(' - ');
    }
    if (typeof payload.sku === 'string' || typeof payload.name === 'string') {
      const parts = [payload.sku, payload.name].filter(
        (part): part is string =>
          typeof part === 'string' && part.trim().length > 0,
      );
      if (parts.length > 0) return parts.join(' - ');
    }
    return undefined;
  }
}
