import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopCheckIn,
  WorkshopCheckInStatus,
  WorkshopMediaPurpose,
} from '@prisma/client';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import type {
  CreateWorkshopCheckInDto,
  UpdateWorkshopCheckInDto,
} from './dto/workshop-check-in.dto.js';
import {
  DEFAULT_CHECK_IN_CONDITION_JSON,
  EMPTY_DAMAGE_MARKERS_JSON,
} from './workshop-check-in.defaults.js';
import { serializeCheckInDamageMarkers } from './workshop-check-in-damage-markers.js';
import { assertCheckInDamageMarkerMediaIds } from './workshop-check-in-media-validation.js';
import { toWorkshopCheckInResponse } from './workshop-check-in.mapper.js';
import type { WorkshopCheckInResponseDto } from './dto/workshop-check-in.dto.js';
import {
  CHECK_IN_ALLOWED_ORDER_STATUSES,
  CHECK_IN_ERROR_CODES,
} from './workshop-check-in.rules.js';
import { resolveEstimateScope } from './workshop-estimate-scope.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertCheckInDraftForMutation } from './workshop-check-in-immutability.js';
import {
  buildWorkshopCheckInEvidenceSnapshot,
  hashWorkshopCheckInEvidenceSnapshot,
} from './workshop-check-in-evidence-snapshot.js';
import { ensureAnnahmeInspectionForOrder } from './workshop-check-in-annahme.helpers.js';
import {
  lockWorkshopCheckInForUpdate,
  lockWorkshopOrderForUpdate,
} from './workshop-check-in-lock.helpers.js';
import type { CompleteWorkshopCheckInDto } from './dto/workshop-check-in.dto.js';
import {
  CHECK_IN_ACKNOWLEDGEMENT_VERSION,
  resolveCheckInAcknowledgementText,
} from './workshop-check-in-acknowledgement.js';
import {
  hashCheckInDeviceEvidence,
  hashCheckInIpEvidence,
  sha256Buffer,
} from './workshop-check-in-request-evidence.js';

export type WorkshopCheckInCreateResult = {
  body: WorkshopCheckInResponseDto;
  created: boolean;
};

function isCheckInUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class WorkshopCheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly mediaStorage: MechanicMediaStorage,
  ) {}

  async create(
    orderId: string,
    dto: CreateWorkshopCheckInDto,
  ): Promise<WorkshopCheckInCreateResult> {
    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });

    await this.findMutableOrder(tenantId, siteId, orderId);

    const existingByOrder = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
    });
    if (existingByOrder) {
      if (existingByOrder.id === dto.id) {
        const linked = await this.ensureInspectionLinked(
          tenantId,
          existingByOrder.id,
        );
        if (!linked) {
          throw new NotFoundException('Workshop check-in not found');
        }
        return {
          body: await this.toResponse(linked),
          created: false,
        };
      }
      throw new ConflictException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_EXISTS,
        message: 'This workshop order already has a check-in record.',
        existing_check_in_id: existingByOrder.id,
      });
    }

    const existingById = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, id: dto.id },
    });
    if (existingById) {
      throw new ConflictException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_EXISTS,
        message: 'Check-in id is already used for another workshop order.',
      });
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await lockSitesAndAssertActive(tx, tenantId, [siteId]);
        await lockWorkshopOrderForUpdate(tx, tenantId, orderId);
        const order = await tx.workshopOrder.findFirst({
          where: { id: orderId, tenant_id: tenantId, site_id: siteId },
          select: { id: true, status: true, odometer: true, fuel_level: true },
        });
        if (!order) {
          throw new NotFoundException('Workshop order not found');
        }
        if (!CHECK_IN_ALLOWED_ORDER_STATUSES.has(order.status)) {
          throw new UnprocessableEntityException({
            code: CHECK_IN_ERROR_CODES.CHECK_IN_ORDER_STATUS,
            message:
              'Check-in is only available while the order is in intake or in progress.',
            order_status: order.status,
          });
        }

        const inspectionId = await ensureAnnahmeInspectionForOrder(
          tx,
          tenantId,
          orderId,
        );

        return tx.workshopCheckIn.create({
          data: {
            id: dto.id,
            tenant_id: tenantId,
            workshop_order_id: orderId,
            status: WorkshopCheckInStatus.DRAFT,
            revision: 1,
            condition_json: DEFAULT_CHECK_IN_CONDITION_JSON,
            damage_markers_json: EMPTY_DAMAGE_MARKERS_JSON,
            items_left: '',
            key_count: 0,
            warning_lights: [],
            odometer: order.odometer,
            fuel_level: order.fuel_level,
            inspection_id: inspectionId,
          },
        });
      });

      return { body: await this.toResponse(created), created: true };
    } catch (error) {
      if (!isCheckInUniqueViolation(error)) {
        throw error;
      }
      const body = await this.resolveCreateUniqueViolation(
        tenantId,
        orderId,
        dto.id,
      );
      return { body, created: false };
    }
  }

  async get(orderId: string): Promise<WorkshopCheckInResponseDto> {
    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    await this.assertOrderInSite(tenantId, siteId, orderId);

    const row = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
    });
    if (!row) {
      throw new NotFoundException('Workshop check-in not found');
    }

    return this.toResponse(row);
  }

  async updateDraft(
    orderId: string,
    dto: UpdateWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    await this.findMutableOrder(tenantId, siteId, orderId);

    const checkIn = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
      select: { id: true },
    });
    if (!checkIn) {
      throw new NotFoundException('Workshop check-in not found');
    }

    if (dto.damage_markers !== undefined) {
      await assertCheckInDamageMarkerMediaIds(
        this.prisma,
        tenantId,
        checkIn.id,
        dto.damage_markers,
      );
    }

    const draftWhere = {
      tenant_id: tenantId,
      workshop_order_id: orderId,
      revision: dto.expected_revision,
      status: WorkshopCheckInStatus.DRAFT,
    } satisfies Prisma.WorkshopCheckInWhereInput;

    const data: Prisma.WorkshopCheckInUpdateManyMutationInput = {
      revision: { increment: 1 },
    };

    if (dto.condition !== undefined) {
      data.condition_json = {
        schema_version: 1,
        tyre_season: dto.condition.tyre_season,
        exterior_notes: dto.condition.exterior_notes,
        interior_notes: dto.condition.interior_notes,
      };
    }
    if (dto.damage_markers !== undefined) {
      data.damage_markers_json = serializeCheckInDamageMarkers(
        dto.damage_markers,
      );
    }
    if (dto.items_left !== undefined) {
      data.items_left = dto.items_left;
    }
    if (dto.key_count !== undefined) {
      data.key_count = dto.key_count;
    }
    if (dto.warning_lights !== undefined) {
      data.warning_lights = [...new Set(dto.warning_lights)];
    }
    if (dto.odometer !== undefined) {
      data.odometer = dto.odometer;
    }
    if (dto.fuel_level !== undefined) {
      data.fuel_level = dto.fuel_level;
    }

    const nextRevision = dto.expected_revision + 1;

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.workshopCheckIn.updateMany({
        where: draftWhere,
        data,
      });

      if (count === 0) {
        const row = await tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, workshop_order_id: orderId },
        });
        if (!row) {
          throw new NotFoundException('Workshop check-in not found');
        }
        if (row.status === WorkshopCheckInStatus.COMPLETED) {
          assertCheckInDraftForMutation(row.status);
        }
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in revision is stale. Reload and retry.',
        });
      }

      const updated = await tx.workshopCheckIn.findFirst({
        where: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          revision: nextRevision,
        },
      });
      if (!updated) {
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in revision is stale. Reload and retry.',
        });
      }

      return this.toResponse(updated);
    });
  }

  async complete(
    orderId: string,
    dto: CompleteWorkshopCheckInDto,
    requestEvidence: {
      userAgent?: string;
      ip?: string;
    } = {},
  ): Promise<WorkshopCheckInResponseDto> {
    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    await this.findMutableOrder(tenantId, siteId, orderId);

    const completedByUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    const signedByName = dto.signed_by_name.trim();
    if (!signedByName) {
      throw new UnprocessableEntityException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_SIGNATURE_REQUIRED,
        message:
          'Customer signature evidence is required to complete check-in.',
      });
    }

    const draftForSignature = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
      select: { id: true, status: true },
    });
    if (!draftForSignature) {
      throw new NotFoundException('Workshop check-in not found');
    }
    if (draftForSignature.status === WorkshopCheckInStatus.COMPLETED) {
      const completed = await this.prisma.workshopCheckIn.findFirst({
        where: { tenant_id: tenantId, workshop_order_id: orderId },
      });
      if (!completed) {
        throw new NotFoundException('Workshop check-in not found');
      }
      return this.assertCompletedSignatureMatches(
        tenantId,
        draftForSignature.id,
        completed,
        dto,
      );
    }

    const signatureMedia = await this.prisma.workshopMedia.findFirst({
      where: {
        tenant_id: tenantId,
        id: dto.signature_media_id,
        check_in_id: draftForSignature.id,
        workshop_order_id: orderId,
        purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
      },
      select: {
        id: true,
        storage_bucket: true,
        storage_key: true,
        mime_type: true,
      },
    });
    if (!signatureMedia || signatureMedia.mime_type !== 'image/png') {
      throw new UnprocessableEntityException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_SIGNATURE_REQUIRED,
        message:
          'Customer signature evidence is required to complete check-in.',
      });
    }

    let signatureContentSha256: string;
    try {
      const bytes = await this.mediaStorage.readObjectBytes(
        signatureMedia.storage_bucket,
        signatureMedia.storage_key,
      );
      signatureContentSha256 = sha256Buffer(bytes);
    } catch {
      throw new UnprocessableEntityException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_SIGNATURE_REQUIRED,
        message:
          'Customer signature evidence is required to complete check-in.',
      });
    }

    const signedAt = new Date();
    const deviceHash = hashCheckInDeviceEvidence(
      tenantId,
      requestEvidence.userAgent,
    );
    const ipHash = hashCheckInIpEvidence(tenantId, requestEvidence.ip);
    const acknowledgementText = resolveCheckInAcknowledgementText(
      dto.acknowledgement_locale,
    );
    if (dto.acknowledgement_version !== CHECK_IN_ACKNOWLEDGEMENT_VERSION) {
      throw new UnprocessableEntityException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_SIGNATURE_REQUIRED,
        message:
          'Customer signature evidence is required to complete check-in.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, tenantId, [siteId]);

      const order = await tx.workshopOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId, site_id: siteId },
        select: { id: true, status: true },
      });
      if (!order) {
        throw new NotFoundException('Workshop order not found');
      }
      if (!CHECK_IN_ALLOWED_ORDER_STATUSES.has(order.status)) {
        throw new UnprocessableEntityException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_ORDER_STATUS,
          message:
            'Check-in is only available while the order is in intake or in progress.',
          order_status: order.status,
        });
      }

      const existing = await tx.workshopCheckIn.findFirst({
        where: { tenant_id: tenantId, workshop_order_id: orderId },
      });
      if (!existing) {
        throw new NotFoundException('Workshop check-in not found');
      }

      if (existing.status === WorkshopCheckInStatus.COMPLETED) {
        return this.assertCompletedSignatureMatches(
          tenantId,
          existing.id,
          existing,
          dto,
        );
      }

      if (existing.revision !== dto.expected_revision) {
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in revision is stale. Reload and retry.',
        });
      }

      const media = await tx.workshopMedia.findMany({
        where: { tenant_id: tenantId, check_in_id: existing.id },
        select: {
          id: true,
          purpose: true,
          mime_type: true,
          size_bytes: true,
          storage_bucket: true,
          storage_key: true,
          caption: true,
        },
        orderBy: { id: 'asc' },
      });

      const checklistItems = existing.inspection_id
        ? await tx.workshopInspectionItem.findMany({
            where: {
              tenant_id: tenantId,
              workshop_inspection_id: existing.inspection_id,
            },
            select: {
              id: true,
              label_snapshot: true,
              passed: true,
              notes: true,
              inspection_template_item: { select: { sort_order: true } },
            },
            orderBy: [
              { inspection_template_item: { sort_order: 'asc' } },
              { id: 'asc' },
            ],
          })
        : [];

      const completedAt = signedAt;
      const snapshot = buildWorkshopCheckInEvidenceSnapshot({
        row: existing,
        media,
        checklistItems: checklistItems.map((item) => ({
          id: item.id,
          label_snapshot: item.label_snapshot,
          passed: item.passed,
          notes: item.notes,
          sort_order: item.inspection_template_item?.sort_order ?? 0,
        })),
        completedAt,
        completedByUserId,
        signature: {
          media_id: signatureMedia.id,
          content_sha256: signatureContentSha256,
          signed_by_name: signedByName,
          signed_at: signedAt,
          acknowledgement_version: CHECK_IN_ACKNOWLEDGEMENT_VERSION,
          acknowledgement_text: acknowledgementText,
        },
      });
      const contentSha256 = hashWorkshopCheckInEvidenceSnapshot(snapshot);
      const nextRevision = existing.revision + 1;

      const { count } = await tx.workshopCheckIn.updateMany({
        where: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          id: existing.id,
          status: WorkshopCheckInStatus.DRAFT,
          revision: dto.expected_revision,
        },
        data: {
          status: WorkshopCheckInStatus.COMPLETED,
          revision: nextRevision,
          snapshot_json: snapshot,
          content_sha256: contentSha256,
          completed_at: completedAt,
          completed_by_user_id: completedByUserId,
          signed_by_name: signedByName,
          signed_at: signedAt,
          acknowledgement_version: CHECK_IN_ACKNOWLEDGEMENT_VERSION,
          acknowledgement_text: acknowledgementText,
          device_hash: deviceHash,
          ip_hash: ipHash,
        },
      });

      if (count === 0) {
        const latest = await tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, workshop_order_id: orderId },
        });
        if (!latest) {
          throw new NotFoundException('Workshop check-in not found');
        }
        if (latest.status === WorkshopCheckInStatus.COMPLETED) {
          return this.assertCompletedSignatureMatches(
            tenantId,
            latest.id,
            latest,
            dto,
          );
        }
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in revision is stale. Reload and retry.',
        });
      }

      const completed = await tx.workshopCheckIn.findFirst({
        where: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          status: WorkshopCheckInStatus.COMPLETED,
          revision: nextRevision,
        },
      });
      if (!completed) {
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in completion raced with another request.',
        });
      }

      return this.toResponse(completed);
    });
  }

  private async findSignatureMediaId(
    tenantId: string,
    checkInId: string,
  ): Promise<string | null> {
    const row = await this.prisma.workshopMedia.findFirst({
      where: {
        tenant_id: tenantId,
        check_in_id: checkInId,
        purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
      },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async toResponse(
    row: WorkshopCheckIn,
  ): Promise<WorkshopCheckInResponseDto> {
    const signatureMediaId = await this.findSignatureMediaId(
      row.tenant_id,
      row.id,
    );
    return toWorkshopCheckInResponse(row, signatureMediaId);
  }

  private async assertCompletedSignatureMatches(
    tenantId: string,
    checkInId: string,
    existing: WorkshopCheckIn,
    dto: CompleteWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    const storedMediaId = await this.findSignatureMediaId(tenantId, checkInId);
    const nameMatches =
      (existing.signed_by_name?.trim() ?? '') === dto.signed_by_name.trim();
    const mediaMatches = storedMediaId === dto.signature_media_id;
    if (!nameMatches || !mediaMatches) {
      throw new ConflictException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
        message:
          'Check-in was already completed with different signature evidence.',
      });
    }
    return toWorkshopCheckInResponse(existing, storedMediaId);
  }

  private async ensureInspectionLinked(tenantId: string, checkInId: string) {
    const snapshot = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, id: checkInId },
    });
    if (!snapshot) {
      return null;
    }
    if (
      snapshot.inspection_id ||
      snapshot.status !== WorkshopCheckInStatus.DRAFT
    ) {
      return snapshot;
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await lockWorkshopCheckInForUpdate(
        tx,
        tenantId,
        checkInId,
      );
      if (!locked) {
        return null;
      }
      if (
        locked.inspection_id ||
        locked.status !== WorkshopCheckInStatus.DRAFT
      ) {
        return tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, id: checkInId },
        });
      }

      await lockWorkshopOrderForUpdate(tx, tenantId, locked.workshop_order_id);
      const inspectionId = await ensureAnnahmeInspectionForOrder(
        tx,
        tenantId,
        locked.workshop_order_id,
      );
      if (!inspectionId) {
        return tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, id: checkInId },
        });
      }
      const { count } = await tx.workshopCheckIn.updateMany({
        where: {
          tenant_id: tenantId,
          id: checkInId,
          status: WorkshopCheckInStatus.DRAFT,
          inspection_id: null,
        },
        data: { inspection_id: inspectionId },
      });
      if (count === 0) {
        const current = await tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, id: checkInId },
        });
        if (current?.inspection_id) {
          return current;
        }
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in changed while linking the reception checklist.',
        });
      }
      return tx.workshopCheckIn.findFirst({
        where: { tenant_id: tenantId, id: checkInId },
      });
    });
  }

  private async resolveCreateUniqueViolation(
    tenantId: string,
    orderId: string,
    requestedId: string,
  ): Promise<WorkshopCheckInResponseDto> {
    const existingByOrder = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
    });
    if (existingByOrder?.id === requestedId) {
      const linked = await this.ensureInspectionLinked(
        tenantId,
        existingByOrder.id,
      );
      if (!linked) {
        throw new NotFoundException('Workshop check-in not found');
      }
      return this.toResponse(linked);
    }

    throw new ConflictException({
      code: CHECK_IN_ERROR_CODES.CHECK_IN_EXISTS,
      message: 'This workshop order already has a check-in record.',
      existing_check_in_id: existingByOrder?.id ?? null,
    });
  }

  private async assertOrderInSite(
    tenantId: string,
    siteId: string,
    orderId: string,
  ): Promise<void> {
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }
  }

  private async findMutableOrder(
    tenantId: string,
    siteId: string,
    orderId: string,
  ) {
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true, status: true, odometer: true, fuel_level: true },
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }
    if (!CHECK_IN_ALLOWED_ORDER_STATUSES.has(order.status)) {
      throw new UnprocessableEntityException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_ORDER_STATUS,
        message:
          'Check-in is only available while the order is in intake or in progress.',
        order_status: order.status,
      });
    }
    return order;
  }
}
