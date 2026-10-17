import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopCheckInStatus } from '@prisma/client';
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
import type { CompleteWorkshopCheckInDto } from './dto/workshop-check-in.dto.js';

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
        const linked = await this.ensureInspectionLinked(tenantId, orderId, {
          id: existingByOrder.id,
          inspection_id: existingByOrder.inspection_id,
          status: existingByOrder.status,
        });
        if (!linked) {
          throw new NotFoundException('Workshop check-in not found');
        }
        return {
          body: toWorkshopCheckInResponse(linked),
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

      return { body: toWorkshopCheckInResponse(created), created: true };
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

    return toWorkshopCheckInResponse(row);
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

      return toWorkshopCheckInResponse(updated);
    });
  }

  async complete(
    orderId: string,
    dto: CompleteWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    await this.findMutableOrder(tenantId, siteId, orderId);

    const completedByUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

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
        return toWorkshopCheckInResponse(existing);
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

      const completedAt = new Date();
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
          return toWorkshopCheckInResponse(latest);
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

      return toWorkshopCheckInResponse(completed);
    });
  }

  private async ensureInspectionLinked(
    tenantId: string,
    orderId: string,
    row: {
      id: string;
      inspection_id: string | null;
      status: WorkshopCheckInStatus;
    },
  ) {
    if (row.inspection_id || row.status !== WorkshopCheckInStatus.DRAFT) {
      return this.prisma.workshopCheckIn.findFirst({
        where: { tenant_id: tenantId, id: row.id },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const inspectionId = await ensureAnnahmeInspectionForOrder(
        tx,
        tenantId,
        orderId,
      );
      if (!inspectionId) {
        return tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, id: row.id },
        });
      }
      const { count } = await tx.workshopCheckIn.updateMany({
        where: {
          tenant_id: tenantId,
          id: row.id,
          status: WorkshopCheckInStatus.DRAFT,
          inspection_id: null,
        },
        data: { inspection_id: inspectionId },
      });
      if (count === 0) {
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in changed while linking the reception checklist.',
        });
      }
      return tx.workshopCheckIn.findFirst({
        where: { tenant_id: tenantId, id: row.id },
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
      const linked = await this.ensureInspectionLinked(tenantId, orderId, {
        id: existingByOrder.id,
        inspection_id: existingByOrder.inspection_id,
        status: existingByOrder.status,
      });
      if (!linked) {
        throw new NotFoundException('Workshop check-in not found');
      }
      return toWorkshopCheckInResponse(linked);
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
