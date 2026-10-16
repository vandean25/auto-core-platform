import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopCheckInStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import type {
  CreateWorkshopCheckInDto,
  UpdateWorkshopCheckInDto,
} from './dto/workshop-check-in.dto.js';
import {
  DEFAULT_CHECK_IN_CONDITION_JSON,
  EMPTY_DAMAGE_MARKERS_JSON,
} from './workshop-check-in.defaults.js';
import { toWorkshopCheckInResponse } from './workshop-check-in.mapper.js';
import type { WorkshopCheckInResponseDto } from './dto/workshop-check-in.dto.js';
import {
  CHECK_IN_ALLOWED_ORDER_STATUSES,
  CHECK_IN_ERROR_CODES,
} from './workshop-check-in.rules.js';
import { resolveEstimateScope } from './workshop-estimate-scope.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';

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
  ): Promise<WorkshopCheckInResponseDto> {
    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });

    const order = await this.findMutableOrder(tenantId, siteId, orderId);

    const existingByOrder = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
    });
    if (existingByOrder) {
      if (existingByOrder.id === dto.id) {
        return toWorkshopCheckInResponse(existingByOrder);
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

    const created = await this.prisma.workshopCheckIn.create({
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
      },
    });

    return toWorkshopCheckInResponse(created);
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

    const row = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
    });
    if (!row) {
      throw new NotFoundException('Workshop check-in not found');
    }
    if (row.status === WorkshopCheckInStatus.COMPLETED) {
      throw new ConflictException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_COMPLETED,
        message: 'Completed check-in records cannot be edited.',
      });
    }
    if (row.revision !== dto.expected_revision) {
      throw new ConflictException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
        message: 'Check-in revision is stale. Reload and retry.',
      });
    }

    const data: Prisma.WorkshopCheckInUpdateInput = {
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
      data.damage_markers_json = dto.damage_markers.map((marker) => ({
        zone_id: marker.zone_id,
        type: marker.type,
        media_id: marker.media_id ?? null,
      }));
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

    const updated = await this.prisma.workshopCheckIn.update({
      where: { tenant_id: tenantId, id: row.id },
      data,
    });

    return toWorkshopCheckInResponse(updated);
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
