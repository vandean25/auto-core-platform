import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InspectorEvidenceReviewStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import {
  assertInspectorEvidenceManagementAccess,
  canReadInspectorEvidenceAssessment,
} from './inspection-evidence.authorization.js';
import {
  assessEvidence,
  assertDigestFormat,
  clampReviewValidUntil,
  parseAssessmentInstant,
  parseViennaCalendarDate,
  validateEvidencePayload,
} from './inspection-evidence-canonical.js';
import { assertAuthorizedDocumentRef } from './inspection-evidence-document.js';
import {
  employeeNotFound,
  inspectorEvidenceNotFound,
  inspectorEvidenceForbidden,
  invalidAssessmentTimestamp,
  invalidDocumentReference,
  reviewRequired,
  unsupportedSchemaVersion,
} from './inspection-evidence.errors.js';
import type { CreateInspectorEvidenceDto } from './dto/create-inspector-evidence.dto.js';
import {
  InspectorEvidenceReviewDecision,
  type ReviewInspectorEvidenceDto,
} from './dto/review-inspector-evidence.dto.js';
import type { StoredEvidenceRevision } from './inspection-evidence.types.js';
import { INSPECTOR_EVIDENCE_SCHEMA_VERSION } from './inspection-evidence.types.js';

const MAX_LIST_LIMIT = 50;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

@Injectable()
export class InspectorEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async createRevision(employeeId: string, dto: CreateInspectorEvidenceDto) {
    assertInspectorEvidenceManagementAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!employee) {
      throw employeeNotFound(employeeId);
    }

    const payload = this.dtoToPayload(dto);
    try {
      validateEvidencePayload(payload);
      assertDigestFormat(dto.document_digest);
      assertAuthorizedDocumentRef(
        tenantId,
        dto.document_ref,
        isProductionRuntime(),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'UNSUPPORTED_SCHEMA_VERSION'
      ) {
        throw unsupportedSchemaVersion();
      }
      if (
        error instanceof Error &&
        error.message === 'INVALID_DOCUMENT_REFERENCE'
      ) {
        throw invalidDocumentReference();
      }
      throw new UnprocessableEntityException({
        code: 'INVALID_EVIDENCE_PAYLOAD',
      });
    }

    if (dto.predecessor_revision_id) {
      const predecessor = await this.prisma.inspectorEvidenceRevision.findFirst(
        {
          where: {
            id: dto.predecessor_revision_id,
            tenant_id: tenantId,
            employee_id: employeeId,
          },
        },
      );
      if (!predecessor) {
        throw inspectorEvidenceNotFound(dto.predecessor_revision_id);
      }
    }

    const row = await this.prisma.inspectorEvidenceRevision.create({
      data: {
        tenant_id: tenantId,
        employee_id: employeeId,
        site_id: siteId,
        schema_version: payload.schema_version,
        source_version: payload.source_version,
        issuer: payload.issuer,
        source_person_ref: payload.source_person_ref,
        station_ref: payload.station_ref,
        assignment_ref: payload.assignment_ref,
        assignment_from: payload.assignment_from
          ? parseViennaCalendarDate(payload.assignment_from)
          : null,
        assignment_until_exclusive: payload.assignment_until_exclusive
          ? parseViennaCalendarDate(payload.assignment_until_exclusive)
          : null,
        vehicle_classes: payload.vehicle_classes,
        weight_scope: payload.weight_scope,
        brake_course_scope: payload.brake_course_scope,
        training_completed_on: payload.training_completed_on
          ? parseViennaCalendarDate(payload.training_completed_on)
          : null,
        next_training_due_on: payload.next_training_due_on
          ? parseViennaCalendarDate(payload.next_training_due_on)
          : null,
        continuation_from: payload.continuation_from
          ? parseViennaCalendarDate(payload.continuation_from)
          : null,
        continuation_until_exclusive: payload.continuation_until_exclusive
          ? parseViennaCalendarDate(payload.continuation_until_exclusive)
          : null,
        effective_from: payload.effective_from
          ? parseViennaCalendarDate(payload.effective_from)
          : null,
        effective_until_exclusive: payload.effective_until_exclusive
          ? parseViennaCalendarDate(payload.effective_until_exclusive)
          : null,
        withdrawal_effective_at: payload.withdrawal_effective_at
          ? new Date(payload.withdrawal_effective_at)
          : null,
        document_ref: payload.document_ref,
        document_digest: dto.document_digest,
        provenance: payload.provenance,
        evidence_review: InspectorEvidenceReviewStatus.UNREVIEWED,
        predecessor_revision_id: dto.predecessor_revision_id ?? null,
        created_by_user_id: user.id,
      },
    });

    await this.appendSupportEvent({
      tenantId,
      siteId,
      objectId: row.id,
      reason: 'UNREVIEWED',
      actorUserId: user.id,
      sourceDigest: dto.document_digest,
    });

    return this.mapRevision(row, true);
  }

  async reviewRevision(
    employeeId: string,
    revisionId: string,
    dto: ReviewInspectorEvidenceDto,
    now = new Date(),
  ) {
    assertInspectorEvidenceManagementAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const existing = await this.prisma.inspectorEvidenceRevision.findFirst({
      where: { id: revisionId, tenant_id: tenantId, employee_id: employeeId },
    });
    if (!existing) {
      throw inspectorEvidenceNotFound(revisionId);
    }

    if (existing.version !== dto.version) {
      throw reviewRequired();
    }
    if (existing.document_digest !== dto.document_digest) {
      throw reviewRequired();
    }

    const reviewValidUntil = clampReviewValidUntil(
      now,
      new Date(dto.review_valid_until),
    );
    const nextStatus =
      dto.decision === InspectorEvidenceReviewDecision.ACCEPT
        ? InspectorEvidenceReviewStatus.EVIDENCE_REVIEWED
        : InspectorEvidenceReviewStatus.SOURCE_CONFLICT;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.inspectorEvidenceRevision.updateMany({
        where: {
          id: revisionId,
          tenant_id: tenantId,
          employee_id: employeeId,
          version: dto.version,
          document_digest: dto.document_digest,
          evidence_review: InspectorEvidenceReviewStatus.UNREVIEWED,
        },
        data: {
          evidence_review: nextStatus,
          reviewed_at: now,
          review_valid_until: reviewValidUntil,
          reviewed_by_user_id: user.id,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw reviewRequired();
      }
      return tx.inspectorEvidenceRevision.findFirst({
        where: { id: revisionId, tenant_id: tenantId },
      });
    });

    if (!updated) {
      throw inspectorEvidenceNotFound(revisionId);
    }

    await this.appendSupportEvent({
      tenantId,
      siteId,
      objectId: revisionId,
      reason: nextStatus,
      actorUserId: user.id,
      sourceDigest: dto.document_digest,
    });

    return this.mapRevision(updated, true);
  }

  async listRevisions(employeeId: string, page = 1, limit = 20) {
    assertInspectorEvidenceManagementAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);
    const boundedPage = Math.max(page, 1);

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!employee) {
      throw employeeNotFound(employeeId);
    }

    const [rows, total] = await Promise.all([
      this.prisma.inspectorEvidenceRevision.findMany({
        where: { tenant_id: tenantId, employee_id: employeeId },
        orderBy: { createdAt: 'desc' },
        skip: (boundedPage - 1) * boundedLimit,
        take: boundedLimit,
      }),
      this.prisma.inspectorEvidenceRevision.count({
        where: { tenant_id: tenantId, employee_id: employeeId },
      }),
    ]);

    return {
      data: rows.map((row) => this.mapRevision(row, true)),
      meta: {
        page: boundedPage,
        limit: boundedLimit,
        total,
        pageCount: Math.max(1, Math.ceil(total / boundedLimit)),
      },
    };
  }

  async assess(
    employeeId: string,
    query: {
      station_ref: string;
      vehicle_class?: string | null;
      inspection_time?: string;
      as_of?: string;
    },
    now = new Date(),
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenant_id: tenantId },
      select: { id: true, user_id: true },
    });
    if (!employee) {
      throw employeeNotFound(employeeId);
    }

    const access = canReadInspectorEvidenceAssessment(
      this.tenantContext,
      employee.user_id,
    );
    if (access === 'none') {
      throw inspectorEvidenceForbidden();
    }

    const rows = await this.prisma.inspectorEvidenceRevision.findMany({
      where: { tenant_id: tenantId, employee_id: employeeId },
      orderBy: { createdAt: 'desc' },
    });

    const stored = rows.map((row) => this.toStoredRevision(row));

    let inspectionTime: Date;
    let asOf: Date;
    try {
      inspectionTime = parseAssessmentInstant(query.inspection_time, now);
      asOf = parseAssessmentInstant(query.as_of, now);
    } catch {
      throw invalidAssessmentTimestamp();
    }

    const identityConflict = await this.hasCrossEmployeePersonConflict(
      tenantId,
      employeeId,
      stored,
    );

    const assessment = assessEvidence(stored, {
      station_ref: query.station_ref,
      vehicle_class: query.vehicle_class ?? null,
      inspection_time: inspectionTime,
      as_of: asOf,
      identity_conflict: identityConflict,
    });

    return assessment;
  }

  private dtoToPayload(
    dto: CreateInspectorEvidenceDto,
  ): import('./inspection-evidence.types.js').InspectorEvidencePayload {
    if (dto.schema_version !== INSPECTOR_EVIDENCE_SCHEMA_VERSION) {
      throw new Error('UNSUPPORTED_SCHEMA_VERSION');
    }
    return {
      schema_version: dto.schema_version,
      source_version: dto.source_version,
      issuer: dto.issuer,
      source_person_ref: dto.source_person_ref,
      station_ref: dto.station_ref,
      assignment_ref: dto.assignment_ref,
      assignment_from: dto.assignment_from ?? null,
      assignment_until_exclusive: dto.assignment_until_exclusive ?? null,
      vehicle_classes: dto.vehicle_classes,
      weight_scope: dto.weight_scope ?? null,
      brake_course_scope: dto.brake_course_scope ?? null,
      training_completed_on: dto.training_completed_on ?? null,
      next_training_due_on: dto.next_training_due_on ?? null,
      continuation_from: dto.continuation_from ?? null,
      continuation_until_exclusive: dto.continuation_until_exclusive ?? null,
      effective_from: dto.effective_from ?? null,
      effective_until_exclusive: dto.effective_until_exclusive ?? null,
      withdrawal_effective_at: dto.withdrawal_effective_at ?? null,
      document_ref: dto.document_ref,
      provenance: dto.provenance,
    };
  }

  private async hasCrossEmployeePersonConflict(
    tenantId: string,
    employeeId: string,
    revisions: StoredEvidenceRevision[],
  ): Promise<boolean> {
    const refs = new Set<string>();
    for (const row of revisions) {
      if (
        row.evidence_review === 'EVIDENCE_REVIEWED' ||
        row.evidence_review === 'SOURCE_CONFLICT'
      ) {
        refs.add(row.source_person_ref);
      }
    }
    if (refs.size === 0) {
      return false;
    }
    const conflicts = await this.prisma.inspectorEvidenceRevision.count({
      where: {
        tenant_id: tenantId,
        employee_id: { not: employeeId },
        source_person_ref: { in: [...refs] },
        evidence_review: {
          in: [
            InspectorEvidenceReviewStatus.EVIDENCE_REVIEWED,
            InspectorEvidenceReviewStatus.SOURCE_CONFLICT,
          ],
        },
      },
    });
    return conflicts > 0;
  }

  private toStoredRevision(
    row: Prisma.InspectorEvidenceRevisionGetPayload<Record<string, never>>,
  ): StoredEvidenceRevision {
    return {
      id: row.id,
      predecessor_revision_id: row.predecessor_revision_id,
      created_at: row.createdAt,
      schema_version: row.schema_version,
      source_version: row.source_version,
      issuer: row.issuer,
      source_person_ref: row.source_person_ref,
      station_ref: row.station_ref,
      assignment_ref: row.assignment_ref,
      assignment_from: row.assignment_from
        ? row.assignment_from.toISOString().slice(0, 10)
        : null,
      assignment_until_exclusive: row.assignment_until_exclusive
        ? row.assignment_until_exclusive.toISOString().slice(0, 10)
        : null,
      vehicle_classes: row.vehicle_classes as string[],
      weight_scope: row.weight_scope,
      brake_course_scope: row.brake_course_scope,
      training_completed_on: row.training_completed_on
        ? row.training_completed_on.toISOString().slice(0, 10)
        : null,
      next_training_due_on: row.next_training_due_on
        ? row.next_training_due_on.toISOString().slice(0, 10)
        : null,
      continuation_from: row.continuation_from
        ? row.continuation_from.toISOString().slice(0, 10)
        : null,
      continuation_until_exclusive: row.continuation_until_exclusive
        ? row.continuation_until_exclusive.toISOString().slice(0, 10)
        : null,
      effective_from: row.effective_from
        ? row.effective_from.toISOString().slice(0, 10)
        : null,
      effective_until_exclusive: row.effective_until_exclusive
        ? row.effective_until_exclusive.toISOString().slice(0, 10)
        : null,
      withdrawal_effective_at: row.withdrawal_effective_at
        ? row.withdrawal_effective_at.toISOString()
        : null,
      document_ref: row.document_ref,
      provenance: row.provenance,
      evidence_review: row.evidence_review,
      document_digest: row.document_digest,
      reviewed_at: row.reviewed_at,
      review_valid_until: row.review_valid_until,
    };
  }

  private mapRevision(
    row: Prisma.InspectorEvidenceRevisionGetPayload<Record<string, never>>,
    includeDocumentRef: boolean,
  ) {
    return {
      id: row.id,
      employee_id: row.employee_id,
      site_id: row.site_id,
      schema_version: row.schema_version,
      source_version: row.source_version,
      station_ref: row.station_ref,
      vehicle_classes: row.vehicle_classes as string[],
      evidence_review: row.evidence_review,
      reviewed_at: row.reviewed_at?.toISOString() ?? null,
      review_valid_until: row.review_valid_until?.toISOString() ?? null,
      version: row.version,
      created_at: row.createdAt.toISOString(),
      ...(includeDocumentRef ? { document_ref: row.document_ref } : {}),
    };
  }

  private async appendSupportEvent(params: {
    tenantId: string;
    siteId: string;
    objectId: string;
    reason: string;
    actorUserId: string;
    sourceDigest?: string;
  }) {
    await this.prisma.inspectionSupportEvent.create({
      data: {
        tenant_id: params.tenantId,
        site_id: params.siteId,
        contract_kind: 'INSPECTOR_EVIDENCE',
        object_id: params.objectId,
        source_digest: params.sourceDigest ?? null,
        reason: params.reason,
        actor_user_id: params.actorUserId,
      },
    });
  }
}
