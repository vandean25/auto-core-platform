import {
  Prisma,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PartsShortageResponseDto } from './dto/parts-shortage-response.dto.js';
import type { PartsShortagesQueryDto } from './dto/parts-shortages-query.dto.js';
import { toShortageResponse } from './parts-requisition-lifecycle.mappers.js';
import {
  OPEN_WORKSHOP_ORDER_STATUSES,
  type ShortageLine,
} from './parts-requisition-lifecycle.types.js';

export async function fetchShortages(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  query: PartsShortagesQueryDto,
): Promise<{
  data: PartsShortageResponseDto[];
  meta: Record<string, number>;
}> {
  const lines = await prisma.workshopTaskLineItem.findMany({
    where: {
      tenant_id: tenantId,
      type: WorkshopLineItemType.PART,
      part_execution_status: {
        not: WorkshopPartLineExecutionStatus.CANCELLED,
      },
      workshop_task: {
        tenant_id: tenantId,
        workshop_order: {
          tenant_id: tenantId,
          site_id: siteId,
          status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
          ...(query.workshopOrderId ? { id: query.workshopOrderId } : {}),
          site: { is_active: true },
        },
      },
    },
    select: {
      id: true,
      workshop_task_id: true,
      item_no: true,
      description: true,
      quantity: true,
      parts_reservations: {
        where: { tenant_id: tenantId },
        select: {
          quantity: true,
          quantity_consumed: true,
          quantity_staged: true,
          quantity_returned: true,
          status: true,
        },
      },
      workshop_task: {
        select: {
          id: true,
          workshop_order: {
            select: {
              id: true,
              order_number: true,
              site_id: true,
              vehicle: {
                select: {
                  make: true,
                  make_brand_id: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ workshop_task_id: 'asc' }, { id: 'asc' }],
  });

  const data = lines
    .map((line) => toShortageResponse(line as ShortageLine))
    .filter(
      (shortage): shortage is PartsShortageResponseDto => shortage !== null,
    );

  return {
    data,
    meta: {
      total: data.length,
      page: 1,
      pageSize: data.length || 1,
      pageCount: 1,
    },
  };
}
