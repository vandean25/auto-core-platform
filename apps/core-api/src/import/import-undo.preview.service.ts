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
import {
  checkEntityUndoEligibility,
  isDocOrFinancialImport,
} from './import-undo.guard.js';
import type { ImportJobTotals } from './import.types.js';

function formatCandidate(
  a?: unknown,
  b?: unknown,
  delimiter = ' ',
): string | undefined {
  const parts = [a, b].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(delimiter) : undefined;
}

export function resolveUndoDisplayName(
  payload?: Record<string, unknown> | null,
): string | undefined {
  if (!payload) return undefined;
  const company =
    typeof payload.company_name === 'string' && payload.company_name.trim()
      ? payload.company_name.trim()
      : undefined;

  return (
    formatCandidate(payload.first_name, payload.last_name) ??
    company ??
    formatCandidate(payload.make, payload.model) ??
    formatCandidate(payload.code, payload.description, ' - ') ??
    formatCandidate(payload.sku, payload.name, ' - ')
  );
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

function getAppliedRowsCount(totals: ImportJobTotals | null): number {
  if (!totals) return 0;
  return (totals.create || 0) + (totals.update || 0);
}

function validateJobForPreview(job: ImportJob | null, jobId: string): number {
  if (!job) {
    throw new NotFoundException(`Import job ${jobId} not found`);
  }
  if (job.status === ImportJobStatus.UNDONE) {
    throw new BadRequestException('IMPORT_JOB_ALREADY_UNDONE');
  }
  const appliedRowsCount = getAppliedRowsCount(
    job.totals_json as ImportJobTotals | null,
  );
  const isEligibleStatus =
    job.status === ImportJobStatus.APPLIED ||
    (job.status === ImportJobStatus.FAILED && appliedRowsCount > 0);
  if (!isEligibleStatus) {
    throw new BadRequestException(
      'Import job is not in an undoable state (must be APPLIED or FAILED with applied rows)',
    );
  }
  return appliedRowsCount;
}

function calculateCounts(buckets: UndoBuckets): ImportUndoCountsDto {
  return {
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

    const appliedRowsCount = validateJobForPreview(job, jobId);
    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
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

    const buckets = await this.collectRowBuckets(tenantId, job, appliedRows);
    const counts = calculateCounts(buckets);
    const overallStatus = calculateOverallStatus(counts);

    return {
      jobId,
      status: overallStatus,
      canUndo:
        counts.toDelete > 0 || counts.toRestore > 0 || counts.conflicts > 0,
      counts,
      ...buckets,
    };
  }

  private async collectRowBuckets(
    tenantId: string,
    job: ImportJob,
    rows: ImportJobRow[],
  ): Promise<UndoBuckets> {
    const buckets: UndoBuckets = {
      deletions: [],
      restorations: [],
      conflicts: [],
      blocked: [],
    };
    const effectiveAppliedAt = job.appliedAt ?? job.updatedAt;

    for (const row of rows) {
      await this.processRowPreview(
        tenantId,
        job,
        row,
        effectiveAppliedAt,
        buckets,
      );
    }

    return buckets;
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
