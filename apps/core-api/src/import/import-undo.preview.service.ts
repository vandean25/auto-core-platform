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
  isUndoSupportedEntityType,
} from './import-undo.guard.js';
import { UNDO_BLOCKED_REASONS } from './import-undo.types.js';
import type { ImportJobTotals } from './import.types.js';

const PREVIEW_PAGE_SIZE = 100;
const MAX_PREVIEW_ITEMS_PER_BUCKET = 100;

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
        reason: UNDO_BLOCKED_REASONS.FINANCIAL_IMPORT_CANNOT_BE_UNDONE,
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
    job.status === ImportJobStatus.PARTIALLY_UNDONE ||
    (job.status === ImportJobStatus.FAILED && appliedRowsCount > 0);
  if (!isEligibleStatus) {
    throw new BadRequestException(
      'Import job is not in an undoable state (must be APPLIED, PARTIALLY_UNDONE, or FAILED with applied rows)',
    );
  }
  return appliedRowsCount;
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

    const buckets: UndoBuckets = {
      deletions: [],
      restorations: [],
      conflicts: [],
      blocked: [],
    };

    const counts: ImportUndoCountsDto = {
      total: 0,
      toDelete: 0,
      toRestore: 0,
      conflicts: 0,
      blocked: 0,
    };

    const effectiveAppliedAt = job.appliedAt ?? job.updatedAt;

    let cursor = 0;
    while (true) {
      const rows = await this.prisma.importJobRow.findMany({
        where: {
          tenant_id: tenantId,
          import_job_id: jobId,
          action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
          row_no: { gt: cursor },
          undone_at: null,
        },
        orderBy: { row_no: 'asc' },
        take: PREVIEW_PAGE_SIZE,
      });

      if (rows.length === 0) {
        break;
      }
      cursor = rows[rows.length - 1].row_no;

      for (const row of rows) {
        await this.processRowPreview(
          tenantId,
          job,
          row,
          effectiveAppliedAt,
          buckets,
          counts,
        );
      }
    }

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

  private getStaticRowBlockReason(
    job: ImportJob,
    row: ImportJobRow,
  ): string | null {
    if (!row.entity_id) {
      return UNDO_BLOCKED_REASONS.UNKNOWN;
    }
    if (row.action === ImportRowAction.UPDATE && !row.before_snapshot_json) {
      return UNDO_BLOCKED_REASONS.MISSING_BEFORE_SNAPSHOT;
    }
    if (!isUndoSupportedEntityType(job.entity_type)) {
      return UNDO_BLOCKED_REASONS.UNSUPPORTED_ENTITY_TYPE;
    }
    return null;
  }

  private assignPreviewBucket(
    preview: ImportUndoRowPreviewDto,
    counts: ImportUndoCountsDto,
    buckets: UndoBuckets,
  ): void {
    if (preview.status === 'BLOCKED') {
      counts.blocked++;
      if (buckets.blocked.length < MAX_PREVIEW_ITEMS_PER_BUCKET) {
        buckets.blocked.push(preview);
      }
    } else if (preview.status === 'CONFLICT') {
      counts.conflicts++;
      if (buckets.conflicts.length < MAX_PREVIEW_ITEMS_PER_BUCKET) {
        buckets.conflicts.push(preview);
      }
    } else if (preview.action === 'CREATE') {
      counts.toDelete++;
      if (buckets.deletions.length < MAX_PREVIEW_ITEMS_PER_BUCKET) {
        buckets.deletions.push(preview);
      }
    } else {
      counts.toRestore++;
      if (buckets.restorations.length < MAX_PREVIEW_ITEMS_PER_BUCKET) {
        buckets.restorations.push(preview);
      }
    }
  }

  private async processRowPreview(
    tenantId: string,
    job: ImportJob,
    row: ImportJobRow,
    effectiveAppliedAt: Date,
    buckets: UndoBuckets,
    counts: ImportUndoCountsDto,
  ): Promise<void> {
    counts.total++;
    const payload = row.normalized_json as Record<string, unknown> | null;
    const displayName = resolveUndoDisplayName(payload);
    const action = row.action === ImportRowAction.CREATE ? 'CREATE' : 'UPDATE';

    const staticBlockReason = this.getStaticRowBlockReason(job, row);
    if (staticBlockReason) {
      counts.blocked++;
      if (buckets.blocked.length < MAX_PREVIEW_ITEMS_PER_BUCKET) {
        buckets.blocked.push({
          rowNumber: row.row_no,
          entityType: job.entity_type,
          entityId: row.entity_id ?? null,
          action,
          status: 'BLOCKED',
          reason: staticBlockReason,
          displayName,
        });
      }
      return;
    }

    const eligibility = await checkEntityUndoEligibility(
      this.prisma,
      tenantId,
      job.entity_type,
      row.entity_id!,
      effectiveAppliedAt,
    );

    const rowPreview: ImportUndoRowPreviewDto = {
      rowNumber: row.row_no,
      entityType: job.entity_type,
      entityId: row.entity_id!,
      action,
      status: eligibility.status,
      reason: eligibility.reason,
      references: eligibility.references,
      displayName,
    };

    this.assignPreviewBucket(rowPreview, counts, buckets);
  }
}
