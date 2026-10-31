import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportJob,
  ImportJobStatus,
  ImportJobRow,
  ImportRowAction,
} from '@prisma/client';
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

function formatName(first?: unknown, last?: unknown): string | undefined {
  const parts = [first, last].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function formatCode(code?: unknown, desc?: unknown): string | undefined {
  const parts = [code, desc].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' - ') : undefined;
}

export function resolveUndoDisplayName(
  payload?: Record<string, unknown> | null,
): string | undefined {
  if (!payload) return undefined;
  if (
    typeof payload.first_name === 'string' ||
    typeof payload.last_name === 'string'
  ) {
    return formatName(payload.first_name, payload.last_name);
  }
  if (typeof payload.company_name === 'string' && payload.company_name.trim()) {
    return payload.company_name.trim();
  }
  if (typeof payload.make === 'string' || typeof payload.model === 'string') {
    return formatName(payload.make, payload.model);
  }
  if (
    typeof payload.code === 'string' ||
    typeof payload.description === 'string'
  ) {
    return formatCode(payload.code, payload.description);
  }
  if (typeof payload.sku === 'string' || typeof payload.name === 'string') {
    return formatCode(payload.sku, payload.name);
  }
  return undefined;
}

interface UndoBuckets {
  deletions: ImportUndoRowPreviewDto[];
  restorations: ImportUndoRowPreviewDto[];
  conflicts: ImportUndoRowPreviewDto[];
  blocked: ImportUndoRowPreviewDto[];
}

function sortRowIntoBuckets(
  rowPreview: ImportUndoRowPreviewDto,
  buckets: UndoBuckets,
): void {
  if (rowPreview.status === 'BLOCKED') {
    buckets.blocked.push(rowPreview);
  } else if (rowPreview.status === 'CONFLICT') {
    buckets.conflicts.push(rowPreview);
  } else if (rowPreview.action === 'CREATE') {
    buckets.deletions.push(rowPreview);
  } else {
    buckets.restorations.push(rowPreview);
  }
}

function isDocOrFinancialImport(entityType: string): boolean {
  return (
    entityType === 'LEGACY_INVOICE' ||
    entityType === 'LEGACY_SERVICE_ORDER' ||
    entityType === 'STOCK_OPENING_BALANCE' ||
    entityType === 'OPEN_WORKSHOP_ORDER'
  );
}

function buildBlockedDocumentPreview(
  jobId: string,
  entityType: string,
  total: number,
): ImportUndoPreviewResponseDto {
  return {
    jobId,
    status: 'BLOCKED',
    canUndo: false,
    counts: {
      total,
      toDelete: 0,
      toRestore: 0,
      conflicts: 0,
      blocked: total,
    },
    deletions: [],
    restorations: [],
    conflicts: [],
    blocked: [
      {
        rowNumber: 0,
        entityType,
        entityId: null,
        action: 'CREATE',
        status: 'BLOCKED',
        reason: 'Financial and document imports cannot be undone',
      },
    ],
  };
}

function calculateOverallStatus(
  counts: ImportUndoCountsDto,
): 'ELIGIBLE' | 'CONFLICT' | 'BLOCKED' {
  if (
    counts.blocked > 0 &&
    counts.toDelete === 0 &&
    counts.toRestore === 0 &&
    counts.conflicts === 0
  ) {
    return 'BLOCKED';
  }
  if (counts.conflicts > 0) {
    return 'CONFLICT';
  }
  return 'ELIGIBLE';
}

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

    if (isDocOrFinancialImport(job.entity_type)) {
      return buildBlockedDocumentPreview(
        jobId,
        job.entity_type,
        appliedRowsCount,
      );
    }

    const appliedRows = await this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
      },
      orderBy: { row_no: 'asc' },
    });

    const buckets: UndoBuckets = {
      deletions: [],
      restorations: [],
      conflicts: [],
      blocked: [],
    };

    const effectiveAppliedAt = job.appliedAt ?? job.updatedAt;

    for (const row of appliedRows) {
      await this.processRowPreview(
        tenantId,
        job,
        row,
        effectiveAppliedAt,
        buckets,
      );
    }

    const counts: ImportUndoCountsDto = {
      total:
        buckets.deletions.length +
        buckets.restorations.length +
        buckets.conflicts.length +
        buckets.blocked.length,
      toDelete: buckets.deletions.length,
      toRestore: buckets.restorations.length,
      conflicts: buckets.conflicts.length,
      blocked: buckets.blocked.length,
    };

    const overallStatus = calculateOverallStatus(counts);

    const canUndo =
      counts.toDelete > 0 || counts.toRestore > 0 || counts.conflicts > 0;

    return {
      jobId,
      status: overallStatus,
      canUndo,
      counts,
      ...buckets,
    };
  }

  private async processRowPreview(
    tenantId: string,
    job: ImportJob,
    row: ImportJobRow,
    effectiveAppliedAt: Date,
    buckets: UndoBuckets,
  ): Promise<void> {
    if (!row.entity_id) return;

    const payload = row.normalized_json as Record<string, unknown> | null;
    const displayName = resolveUndoDisplayName(payload);
    const action = row.action === ImportRowAction.CREATE ? 'CREATE' : 'UPDATE';

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

    sortRowIntoBuckets(rowPreview, buckets);
  }
}
