import { Injectable } from '@nestjs/common';
import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import type { ImportJob, ImportJobRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import {
  ImportUndoCountsDto,
  ImportUndoPreviewResponseDto,
  ImportUndoRowPreviewDto,
} from './dto/undo-import-preview-response.dto.js';
import {
  checkEntitiesUndoEligibility,
  isDocOrFinancialImport,
  isUndoSupportedEntityType,
} from './import-undo.guard.js';
import {
  UNDO_BLOCKED_REASONS,
  type ImportUndoEligibility,
} from './import-undo.types.js';
import {
  importJobAlreadyUndone,
  importJobExpired,
  importJobNotFound,
  importJobNotUndoable,
} from './import-job.errors.js';
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

function buildBlockedPreview(
  jobId: string,
  entityType: string,
  total: number,
  reason: (typeof UNDO_BLOCKED_REASONS)[keyof typeof UNDO_BLOCKED_REASONS],
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
        reason,
      },
    ],
  };
}

function getAppliedRowsCount(totals: ImportJobTotals | null): number {
  if (!totals) return 0;
  return (totals.create || 0) + (totals.update || 0);
}

function validateJobForPreview(job: ImportJob | null): number {
  if (!job) {
    throw importJobNotFound();
  }
  if (job.status === ImportJobStatus.UNDONE) {
    throw importJobAlreadyUndone();
  }
  const jobOptions = (job.options_json ?? {}) as Record<string, unknown>;
  if (jobOptions.cancel_reason === 'expired') {
    throw importJobExpired();
  }
  const appliedRowsCount = getAppliedRowsCount(
    job.totals_json as ImportJobTotals | null,
  );
  const isEligibleStatus =
    job.status === ImportJobStatus.APPLIED ||
    job.status === ImportJobStatus.PARTIALLY_UNDONE ||
    (job.status === ImportJobStatus.FAILED && appliedRowsCount > 0);
  if (!isEligibleStatus) {
    throw importJobNotUndoable();
  }
  return appliedRowsCount;
}

function checkBlockedJobPreview(
  job: ImportJob,
  appliedRowsCount: number,
): ImportUndoPreviewResponseDto | null {
  if (isDocOrFinancialImport(job.entity_type)) {
    return buildBlockedPreview(
      job.id,
      job.entity_type,
      appliedRowsCount,
      UNDO_BLOCKED_REASONS.FINANCIAL_IMPORT_CANNOT_BE_UNDONE,
    );
  }
  const jobOptions = (job.options_json ?? {}) as Record<string, unknown>;
  if (jobOptions.rows_purged === true) {
    return buildBlockedPreview(
      job.id,
      job.entity_type,
      appliedRowsCount,
      UNDO_BLOCKED_REASONS.ROWS_PURGED,
    );
  }
  return null;
}

function canUndoCounts(counts: ImportUndoCountsDto): boolean {
  return counts.toDelete > 0 || counts.toRestore > 0 || counts.conflicts > 0;
}

function isPurgedByCount(total: number, appliedRowsCount: number): boolean {
  return total === 0 && appliedRowsCount > 0;
}

function getEffectiveAppliedAt(job: ImportJob): Date {
  return job.appliedAt ?? job.updatedAt;
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

function getStaticRowBlockReason(
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

function buildRowPreview(
  job: ImportJob,
  row: ImportJobRow,
  eligibility: Map<string, ImportUndoEligibility>,
): ImportUndoRowPreviewDto {
  const preview: ImportUndoRowPreviewDto = {
    rowNumber: row.row_no,
    entityType: job.entity_type,
    entityId: row.entity_id ?? null,
    action: row.action === ImportRowAction.CREATE ? 'CREATE' : 'UPDATE',
    displayName: resolveUndoDisplayName(
      row.normalized_json as Record<string, unknown> | null,
    ),
    status: 'ELIGIBLE',
  };
  const staticBlockReason = getStaticRowBlockReason(job, row);
  if (staticBlockReason) {
    return { ...preview, status: 'BLOCKED', reason: staticBlockReason };
  }
  const check = eligibility.get(row.entity_id as string);
  if (!check) {
    return {
      ...preview,
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.UNKNOWN,
    };
  }
  return {
    ...preview,
    status: check.status,
    reason: check.reason,
    references: check.references,
  };
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

    const appliedRowsCount = validateJobForPreview(job);
    const earlyBlocked = checkBlockedJobPreview(job!, appliedRowsCount);
    if (earlyBlocked) {
      return earlyBlocked;
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

    await this.scanPreviewRows(
      tenantId,
      job!,
      jobId,
      getEffectiveAppliedAt(job!),
      buckets,
      counts,
    );

    if (isPurgedByCount(counts.total, appliedRowsCount)) {
      return buildBlockedPreview(
        jobId,
        job!.entity_type,
        appliedRowsCount,
        UNDO_BLOCKED_REASONS.ROWS_PURGED,
      );
    }

    return {
      jobId,
      status: calculateOverallStatus(counts),
      canUndo: canUndoCounts(counts),
      counts,
      ...buckets,
    };
  }

  private async scanPreviewRows(
    tenantId: string,
    job: ImportJob,
    jobId: string,
    effectiveAppliedAt: Date,
    buckets: UndoBuckets,
    counts: ImportUndoCountsDto,
  ): Promise<void> {
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

      await this.processRowPage(
        tenantId,
        job,
        rows,
        effectiveAppliedAt,
        buckets,
        counts,
      );
    }
  }

  /** One batched eligibility lookup per page: no per-row reference queries. */
  private async processRowPage(
    tenantId: string,
    job: ImportJob,
    rows: ImportJobRow[],
    effectiveAppliedAt: Date,
    buckets: UndoBuckets,
    counts: ImportUndoCountsDto,
  ): Promise<void> {
    const eligibility = await checkEntitiesUndoEligibility(
      this.prisma,
      tenantId,
      job.entity_type,
      rows
        .map((row) => row.entity_id)
        .filter((id): id is string => Boolean(id)),
      effectiveAppliedAt,
    );
    for (const row of rows) {
      counts.total++;
      this.assignPreviewBucket(
        buildRowPreview(job, row, eligibility),
        counts,
        buckets,
      );
    }
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
}
