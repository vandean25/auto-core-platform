import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import { assertTyreStorageRead } from '../tyre-storage/tyre-storage-access.js';
import { validateTyreThresholdOverrides } from './tyre-thresholds.js';
import { captureTyreWheel } from './tyre-measurement-capture.js';
import type {
  CreateTyreMeasurementDto,
  TyreMeasurementListResponseDto,
  TyreMeasurementQueryDto,
  TyreMeasurementResponseDto,
} from './tyre-measurement.dto.js';
import { toTyreMeasurementResponse } from './tyre-measurement-response.js';

type CaptureParent = { kind: 'order' | 'checkIn'; id: string };
type ReadParent = CaptureParent | { kind: 'event'; id: string };
type Scope = { tenantId: string; siteId: string };

@Injectable()
export class TyreMeasurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async create(
    parent: CaptureParent,
    dto: CreateTyreMeasurementDto,
  ): Promise<TyreMeasurementResponseDto> {
    const scope = await this.scope();
    const actor = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      scope.tenantId,
    );
    const now = new Date();
    const measuredAt = dto.measuredAt ? new Date(dto.measuredAt) : now;
    if (!Number.isFinite(measuredAt.getTime()) || measuredAt > now) {
      throw new BadRequestException({ code: 'TYRE_EVALUATION_DATE_INVALID' });
    }
    return this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, scope.tenantId, [scope.siteId]);
      const order = await this.captureOrder(tx, scope, parent);
      const checkIn = await tx.workshopCheckIn.findFirst({
        where: {
          tenant_id: scope.tenantId,
          workshop_order_id: order.id,
          workshop_order: { tenant_id: scope.tenantId, site_id: scope.siteId },
        },
        select: { id: true },
      });
      if (dto.tyreSetId) {
        const set = await tx.tyreSet.findFirst({
          where: {
            id: dto.tyreSetId,
            tenant_id: scope.tenantId,
            site_id: scope.siteId,
            vehicle_id: order.vehicle_id,
          },
          select: { id: true },
        });
        if (!set)
          throw new NotFoundException({
            code: 'TYRE_MEASUREMENT_PARENT_NOT_FOUND',
          });
      }
      await this.validateMedia(tx, scope, {
        ids: dto.wheels.flatMap((wheel) =>
          wheel.mediaId ? [wheel.mediaId] : [],
        ),
        orderId: order.id,
        checkInId: checkIn?.id,
      });
      const [legalEntity, settings, user] = await Promise.all([
        tx.legalEntity.findFirstOrThrow({
          where: {
            tenant_id: scope.tenantId,
            sites: { some: { tenant_id: scope.tenantId, id: scope.siteId } },
          },
          select: { country_iso: true },
        }),
        tx.tyreStorageSettings.findFirst({
          where: { tenant_id: scope.tenantId },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: actor.id },
          select: { firstName: true, lastName: true, email: true },
        }),
      ]);
      const context = {
        country: legalEntity.country_iso,
        weightClass: dto.weightClass ?? 'UP_TO_3500_KG',
        asOf: measuredAt,
        overrides: validateTyreThresholdOverrides(
          settings?.recommendation_overrides ?? {},
        ),
      };
      const result = await tx.tyreMeasurement.create({
        data: {
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          vehicle_id: order.vehicle_id,
          workshop_order_id: order.id,
          check_in_id: checkIn?.id ?? null,
          tyre_set_id: dto.tyreSetId ?? null,
          measured_at: measuredAt,
          measured_by: actor.id,
          measured_by_name:
            [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
            user.email,
          country: context.country,
          weight_class: context.weightClass,
          weight_class_source: dto.weightClass ? 'CAPTURE' : 'DEFAULT',
          wheels: {
            create: dto.wheels.map((wheel) => captureTyreWheel(wheel, context)),
          },
        },
        include: {
          wheels: {
            where: { tenant_id: scope.tenantId },
            orderBy: { position: 'asc' },
          },
        },
      });
      return toTyreMeasurementResponse(result);
    });
  }

  async findOne(id: string): Promise<TyreMeasurementResponseDto> {
    const { tenantId, siteId } = await this.scope();
    const measurement = await this.prisma.tyreMeasurement.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
      include: {
        wheels: {
          where: { tenant_id: tenantId },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!measurement)
      throw new NotFoundException({ code: 'TYRE_MEASUREMENT_NOT_FOUND' });
    return toTyreMeasurementResponse(measurement);
  }

  async list(
    parent: ReadParent,
    query: TyreMeasurementQueryDto,
  ): Promise<TyreMeasurementListResponseDto> {
    const scope = await this.scope();
    if (parent.kind === 'event') {
      const event = await this.prisma.tyreSetEvent.findFirst({
        where: {
          id: parent.id,
          tenant_id: scope.tenantId,
          tyre_set: { tenant_id: scope.tenantId, site_id: scope.siteId },
        },
        select: { id: true },
      });
      if (!event)
        throw new NotFoundException({
          code: 'TYRE_MEASUREMENT_PARENT_NOT_FOUND',
        });
    } else {
      await this.captureOrder(this.prisma, scope, parent);
    }
    const parentFilter =
      parent.kind === 'event'
        ? { tyre_set_event_id: parent.id }
        : parent.kind === 'checkIn'
          ? { check_in_id: parent.id }
          : { workshop_order_id: parent.id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tyreMeasurement.findMany({
        where: {
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          ...parentFilter,
        },
        orderBy: [{ measured_at: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          wheels: {
            where: { tenant_id: scope.tenantId },
            orderBy: { position: 'asc' },
          },
        },
      }),
      this.prisma.tyreMeasurement.count({
        where: {
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          ...parentFilter,
        },
      }),
    ]);
    return {
      data: rows.map(toTyreMeasurementResponse),
      meta: {
        page: query.page,
        pageSize: query.limit,
        total,
        pageCount: Math.ceil(total / query.limit),
      },
    };
  }

  private async scope(): Promise<Scope> {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return { tenantId, siteId };
  }

  private async captureOrder(
    tx: Prisma.TransactionClient,
    scope: Scope,
    parent: CaptureParent,
  ) {
    const order = await tx.workshopOrder.findFirst({
      where: {
        tenant_id: scope.tenantId,
        site_id: scope.siteId,
        ...(parent.kind === 'order'
          ? { id: parent.id }
          : { check_in: { tenant_id: scope.tenantId, id: parent.id } }),
      },
      select: { id: true, vehicle_id: true },
    });
    if (!order)
      throw new NotFoundException({
        code: 'TYRE_MEASUREMENT_PARENT_NOT_FOUND',
      });
    return order;
  }

  private async validateMedia(
    tx: Prisma.TransactionClient,
    scope: Scope,
    input: { ids: string[]; orderId: string; checkInId?: string },
  ): Promise<void> {
    const ids = [...new Set(input.ids)];
    if (ids.length === 0) return;
    if (!input.checkInId)
      throw new NotFoundException({ code: 'TYRE_MEASUREMENT_MEDIA_INVALID' });
    const media = await tx.workshopMedia.findMany({
      where: {
        tenant_id: scope.tenantId,
        id: { in: ids },
        workshop_order_id: input.orderId,
        workshop_order: { tenant_id: scope.tenantId, site_id: scope.siteId },
        check_in_id: input.checkInId,
        purpose: 'CHECK_IN',
        mime_type: { startsWith: 'image/' },
      },
      select: { id: true },
    });
    if (media.length !== ids.length)
      throw new NotFoundException({ code: 'TYRE_MEASUREMENT_MEDIA_INVALID' });
  }
}
