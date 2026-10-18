import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PartsRequisitionResponseDto } from './dto/parts-requisition-response.dto.js';
import type { PartsReservationResponseDto } from './dto/parts-reservation-response.dto.js';
import type { PartsShortageResponseDto } from './dto/parts-shortage-response.dto.js';
import {
  getRemainingCommitment,
  isActiveSlice,
} from './parts-requisition.helpers.js';
import {
  type RequisitionDetail,
  type ReservationRow,
  type ShortageLine,
  ZERO,
} from './parts-requisition-lifecycle.types.js';

export function toRequisitionResponse(
  requisition: RequisitionDetail,
): PartsRequisitionResponseDto {
  return {
    id: requisition.id,
    tenantId: requisition.tenant_id,
    vehicleMakeBrandId: requisition.vehicle_make_brand_id,
    status: requisition.status,
    lines: requisition.lines.flatMap((line) => {
      if (!line.reservation) {
        return [];
      }
      const order =
        line.reservation.workshop_task_line_item.workshop_task.workshop_order;

      return [
        {
          id: line.id,
          reservationId: line.reservation.id,
          workshopTaskLineItemId: line.reservation.workshop_task_line_item_id,
          workshopOrderId: order.id,
          workshopOrderNumber: order.order_number,
          itemNo: line.reservation.workshop_task_line_item.item_no,
          description: line.reservation.workshop_task_line_item.description,
          quantity: new Prisma.Decimal(line.reservation.quantity).toString(),
          status: line.reservation.status,
          purchaseOrderItemId: line.reservation.purchase_order_item_id,
          createdAt: line.createdAt,
          updatedAt: line.updatedAt,
        },
      ];
    }),
    createdAt: requisition.createdAt,
    updatedAt: requisition.updatedAt,
  };
}

export async function loadRequisitionResponse(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requisitionId: string,
): Promise<PartsRequisitionResponseDto> {
  const requisition = await tx.partsRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    include: {
      lines: {
        orderBy: { id: 'asc' },
        include: {
          reservation: {
            include: {
              workshop_task_line_item: {
                select: {
                  item_no: true,
                  description: true,
                  workshop_task: {
                    select: {
                      workshop_order: {
                        select: { id: true, order_number: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!requisition) {
    throw new NotFoundException('Parts requisition not found');
  }

  return toRequisitionResponse(requisition);
}

export function toReservationResponse(
  reservation: ReservationRow,
): PartsReservationResponseDto {
  return {
    id: reservation.id,
    tenantId: reservation.tenant_id,
    workshopTaskLineItemId: reservation.workshop_task_line_item_id,
    quantity: new Prisma.Decimal(reservation.quantity).toString(),
    quantityReceived: new Prisma.Decimal(
      reservation.quantity_received ?? ZERO,
    ).toString(),
    quantityConsumed: new Prisma.Decimal(
      reservation.quantity_consumed,
    ).toString(),
    quantityStaged: new Prisma.Decimal(reservation.quantity_staged).toString(),
    quantityReturned: new Prisma.Decimal(
      reservation.quantity_returned,
    ).toString(),
    kind: reservation.kind,
    status: reservation.status,
    locationId: reservation.location_id ?? null,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

export function toShortageResponse(
  line: ShortageLine,
): PartsShortageResponseDto | null {
  const consumedQuantity = line.parts_reservations.reduce(
    (sum, reservation) => sum.add(reservation.quantity_consumed),
    ZERO,
  );
  const activeCommitment = line.parts_reservations.reduce(
    (sum, reservation) => {
      if (!isActiveSlice(reservation)) {
        return sum;
      }

      return sum.add(getRemainingCommitment(reservation));
    },
    ZERO,
  );
  const shortageQuantity = new Prisma.Decimal(line.quantity)
    .sub(consumedQuantity)
    .sub(activeCommitment);

  if (shortageQuantity.lte(ZERO)) {
    return null;
  }

  return {
    workshopOrderId: line.workshop_task.workshop_order.id,
    workshopOrderNumber: line.workshop_task.workshop_order.order_number,
    workshopTaskId: line.workshop_task.id,
    workshopTaskLineItemId: line.id,
    itemNo: line.item_no,
    description: line.description,
    lineQuantity: new Prisma.Decimal(line.quantity).toString(),
    consumedQuantity: consumedQuantity.toString(),
    activeCommitment: activeCommitment.toString(),
    shortageQuantity: shortageQuantity.toString(),
    siteId: line.workshop_task.workshop_order.site_id,
    vehicleMake: line.workshop_task.workshop_order.vehicle.make,
    vehicleMakeBrandId: line.workshop_task.workshop_order.vehicle.make_brand_id,
  };
}
