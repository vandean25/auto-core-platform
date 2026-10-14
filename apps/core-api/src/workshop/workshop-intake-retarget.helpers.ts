import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  Prisma,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto.js';
import {
  assertActiveTargetSiteMembership,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { ORDER_WITH_INVOICE_RELATIONS } from './workshop-intake-query.helpers.js';

export interface AssertOrderRetargetingPrerequisitesParams {
  prisma: PrismaService | Prisma.TransactionClient;
  tenantContext: TenantContextService;
  tenantId: string;
  existing: {
    status: WorkshopOrderStatus;
  };
  dto: UpdateWorkshopOrderDto;
}

export interface ExecuteUpdateOrderRetargetingParams {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  partsRequisitionService: Pick<PartsRequisitionService, 'releaseReservation'>;
  tenantId: string;
  id: string;
  existing: {
    site_id: string | null;
    status: WorkshopOrderStatus;
    staging_location_id: string | null;
    reported_issue: string | null;
    notes: string | null;
    mechanic_id: string | null;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
  };
  persistedSiteId: string;
  dto: UpdateWorkshopOrderDto;
}

export interface ReleaseOrderReservationsForRetargetParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  orderId: string;
  returnLocationId: string | null;
  partsRequisitionService: Pick<PartsRequisitionService, 'releaseReservation'>;
}

export async function releaseOrderReservationsForRetarget(
  params: ReleaseOrderReservationsForRetargetParams,
): Promise<void> {
  const { tx, tenantId, orderId, returnLocationId, partsRequisitionService } =
    params;
  const reservations = await tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      status: {
        in: [
          PartsReservationStatus.OPEN,
          PartsReservationStatus.ORDERED,
          PartsReservationStatus.STAGED,
        ],
      },
      workshop_task_line_item: {
        workshop_task: { workshop_order_id: orderId },
      },
    },
    select: { id: true },
  });

  for (const reservation of reservations) {
    await partsRequisitionService.releaseReservation(
      reservation.id,
      returnLocationId ? { returnLocationId } : {},
      tx,
    );
  }
}

function resolveNullableDate(
  value: string | undefined,
  fallback: Date | null,
): Date | null {
  return value ? new Date(value) : fallback;
}

export function buildWorkshopOrderRetargetData(
  existing: {
    reported_issue: string | null;
    notes: string | null;
    mechanic_id: string | null;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
  },
  dto: UpdateWorkshopOrderDto,
): Prisma.WorkshopOrderUncheckedUpdateManyInput {
  return {
    site_id: dto.siteId,
    bay_id: dto.bayId,
    staging_location_id: null,
    reported_issue:
      dto.reportedIssue !== undefined
        ? dto.reportedIssue
        : existing.reported_issue,
    notes: dto.notes !== undefined ? dto.notes : existing.notes,
    mechanic_id:
      dto.mechanicId !== undefined ? dto.mechanicId : existing.mechanic_id,
    scheduled_start_at: resolveNullableDate(
      dto.scheduledStartAt,
      existing.scheduled_start_at,
    ),
    scheduled_end_at: resolveNullableDate(
      dto.scheduledEndAt,
      existing.scheduled_end_at,
    ),
  };
}

export async function assertOrderRetargetingPrerequisites(
  params: AssertOrderRetargetingPrerequisitesParams,
): Promise<void> {
  const { prisma, tenantContext, tenantId, existing, dto } = params;
  if (existing.status !== WorkshopOrderStatus.SCHEDULED) {
    throw new UnprocessableEntityException(
      'Workshop order site can only be changed while SCHEDULED',
    );
  }

  await assertActiveTargetSiteMembership(
    prisma,
    tenantContext,
    tenantId,
    dto.siteId!,
  );

  if (!dto.bayId) {
    throw new UnprocessableEntityException(
      'A bay on the target site is required when retargeting workshop order',
    );
  }

  const targetBay = await prisma.bay.findFirst({
    where: { id: dto.bayId, tenant_id: tenantId, site_id: dto.siteId! },
    select: { id: true },
  });
  if (!targetBay) {
    throw new UnprocessableEntityException(
      'A bay on the target site is required when retargeting workshop order',
    );
  }
}

export async function executeUpdateOrderRetargeting(
  params: ExecuteUpdateOrderRetargetingParams,
) {
  const {
    prisma,
    tenantContext,
    partsRequisitionService,
    tenantId,
    id,
    existing,
    persistedSiteId,
    dto,
  } = params;

  await assertOrderRetargetingPrerequisites({
    prisma,
    tenantContext,
    tenantId,
    existing,
    dto,
  });

  return prisma.$transaction(async (tx) => {
    await lockSitesAndAssertActive(tx, tenantId, [
      persistedSiteId,
      dto.siteId!,
    ]);

    await releaseOrderReservationsForRetarget({
      tx,
      tenantId,
      orderId: id,
      returnLocationId: existing.staging_location_id,
      partsRequisitionService,
    });

    const data = buildWorkshopOrderRetargetData(existing, dto);

    const updateResult = await tx.workshopOrder.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        site_id: persistedSiteId,
        status: WorkshopOrderStatus.SCHEDULED,
        ...(dto.expectedSiteId ? { site_id: dto.expectedSiteId } : {}),
      },
      data,
    });

    if (updateResult.count === 0) {
      throw new ConflictException(
        'Workshop order state or site changed concurrently. Please refresh.',
      );
    }

    return tx.workshopOrder.findFirstOrThrow({
      where: { id, tenant_id: tenantId, site_id: dto.siteId },
      include: ORDER_WITH_INVOICE_RELATIONS,
    });
  });
}
