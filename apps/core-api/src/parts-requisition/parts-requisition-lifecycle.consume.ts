import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
  TransactionType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import type { LedgerService } from '../inventory/ledger.service.js';
import type { ConsumePartsReservationDto } from './dto/consume-parts-reservation.dto.js';
import type { PartsReservationResponseDto } from './dto/parts-reservation-response.dto.js';
import {
  allocateStagedConsumption,
  recomputeRequisitionStatus,
} from './parts-requisition.helpers.js';
import {
  lockRequisitionLine,
  lockRequisitionReservations,
  lockRequisitionTask,
} from './parts-requisition-lifecycle.locking.js';
import { toReservationResponse } from './parts-requisition-lifecycle.mappers.js';
import { ZERO } from './parts-requisition-lifecycle.types.js';

type StagedReservationForConsume = {
  id: string;
  workshop_task_line_item_id: string;
  quantity: Prisma.Decimal;
  quantity_received?: Prisma.Decimal | null;
  quantity_consumed: Prisma.Decimal;
  quantity_staged: Prisma.Decimal;
  quantity_returned: Prisma.Decimal;
  kind: PartsReservationKind;
  status: PartsReservationStatus;
  location_id?: string | null;
  tote_cost_basis?: Prisma.Decimal | null;
  createdAt: Date;
  requisition_line?: { requisition_id: string } | null;
};

type ConsumeLineContext = {
  id: string;
  workshop_task_id: string;
  catalog_item_id: string;
  quantity: Prisma.Decimal;
  workshop_task: {
    workshop_order: { staging_location_id: string };
  };
};

type ConsumeAllocation = { reservationId: string; quantity: string };

function buildConsumeLedgerTransactions(
  line: ConsumeLineContext,
  reservations: StagedReservationForConsume[],
  allocations: ConsumeAllocation[],
) {
  return allocations.map(({ reservationId: id, quantity: value }) => {
    const reservation = reservations.find((candidate) => candidate.id === id);
    if (!reservation) {
      throw new ConflictException('Reservation changed during consumption.');
    }
    return {
      itemId: line.catalog_item_id,
      locationId: line.workshop_task.workshop_order.staging_location_id,
      quantity: new Prisma.Decimal(value).negated(),
      type: TransactionType.WORKSHOP_CONSUMPTION,
      referenceId: `WO-CONSUME-${line.id}-${id}`,
      costBasis: reservation.tote_cost_basis,
      partsReservationId: id,
    };
  });
}

async function applyConsumeAllocations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservations: StagedReservationForConsume[],
  allocations: ConsumeAllocation[],
): Promise<void> {
  for (const { reservationId: id, quantity: value } of allocations) {
    const reservation = reservations.find((candidate) => candidate.id === id);
    if (!reservation) continue;
    const consumed = reservation.quantity_consumed.add(value);
    const staged = reservation.quantity_staged.sub(value);
    const nextStatus =
      staged.eq(0) &&
      reservation.quantity
        .sub(consumed)
        .sub(reservation.quantity_returned)
        .lte(0)
        ? PartsReservationStatus.FULFILLED
        : PartsReservationStatus.STAGED;
    const result = await tx.partsReservation.updateMany({
      where: {
        tenant_id: tenantId,
        id,
        status: reservation.status,
        quantity_staged: reservation.quantity_staged,
      },
      data: {
        quantity_consumed: { increment: value },
        quantity_staged: { decrement: value },
        status: nextStatus,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('Reservation changed during consumption.');
    }
  }
}

async function finalizeConsumeLineAndRequisitions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: ConsumeLineContext,
  reservations: StagedReservationForConsume[],
  allocations: ConsumeAllocation[],
): Promise<void> {
  const consumedReservations = await tx.partsReservation.findMany({
    where: { tenant_id: tenantId, workshop_task_line_item_id: line.id },
    select: { quantity_consumed: true },
  });
  const consumedQuantity = consumedReservations.reduce(
    (sum, reservation) => sum.add(reservation.quantity_consumed),
    ZERO,
  );
  if (consumedQuantity.gte(line.quantity)) {
    await tx.workshopTaskLineItem.updateMany({
      where: { tenant_id: tenantId, id: line.id },
      data: {
        part_execution_status: WorkshopPartLineExecutionStatus.CONSUMED,
      },
    });
  }

  const requisitionIds = new Set(
    allocations
      .map(
        ({ reservationId: id }) =>
          reservations.find((reservation) => reservation.id === id)
            ?.requisition_line?.requisition_id,
      )
      .filter((id): id is string => Boolean(id)),
  );
  for (const requisitionId of requisitionIds) {
    await recomputeRequisitionStatus(tx, tenantId, requisitionId);
  }

  const versionUpdate = await tx.workshopTask.updateMany({
    where: { id: line.workshop_task_id, tenant_id: tenantId },
    data: { line_items_version: { increment: 1 } },
  });
  if (versionUpdate.count !== 1) {
    throw new ConflictException(
      'Workshop task changed during consumption. Refresh and retry.',
    );
  }
}

export async function executeConsumeReservation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  reservationId: string,
  dto: ConsumePartsReservationDto,
  ledgerService: LedgerService,
): Promise<PartsReservationResponseDto> {
  const quantity = new Prisma.Decimal(dto.quantity);
  const anchor = await tx.partsReservation.findFirst({
    where: {
      tenant_id: tenantId,
      id: reservationId,
      workshop_task_line_item: {
        workshop_task: { workshop_order: { site_id: siteId } },
      },
    },
    select: { workshop_task_line_item_id: true },
  });
  if (!anchor) {
    throw new NotFoundException('Parts reservation not found');
  }

  const line = await tx.workshopTaskLineItem.findFirst({
    where: { id: anchor.workshop_task_line_item_id, tenant_id: tenantId },
    select: {
      id: true,
      workshop_task_id: true,
      catalog_item_id: true,
      quantity: true,
      workshop_task: {
        select: {
          workshop_order: { select: { staging_location_id: true } },
        },
      },
    },
  });
  if (
    !line?.catalog_item_id ||
    !line.workshop_task.workshop_order.staging_location_id
  ) {
    throw new UnprocessableEntityException(
      'Reservation line is not linked to a job tote.',
    );
  }

  const consumeLine: ConsumeLineContext = {
    id: line.id,
    workshop_task_id: line.workshop_task_id,
    catalog_item_id: line.catalog_item_id,
    quantity: line.quantity,
    workshop_task: {
      workshop_order: {
        staging_location_id: line.workshop_task.workshop_order
          .staging_location_id as string,
      },
    },
  };

  await lockRequisitionTask(tx, tenantId, consumeLine.workshop_task_id);
  await lockRequisitionLine(tx, tenantId, consumeLine.id);
  const reservations = await tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      workshop_task_line_item_id: consumeLine.id,
      status: {
        in: [
          PartsReservationStatus.OPEN,
          PartsReservationStatus.ORDERED,
          PartsReservationStatus.STAGED,
        ],
      },
      quantity_staged: { gt: ZERO },
    },
    select: {
      id: true,
      workshop_task_line_item_id: true,
      quantity: true,
      quantity_received: true,
      quantity_consumed: true,
      quantity_staged: true,
      quantity_returned: true,
      kind: true,
      status: true,
      location_id: true,
      tote_cost_basis: true,
      createdAt: true,
      requisition_line: { select: { requisition_id: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  await lockRequisitionReservations(
    tx,
    tenantId,
    reservations.map(({ id }) => id),
  );

  const allocations = allocateStagedConsumption(reservations, quantity);
  const transactions = buildConsumeLedgerTransactions(
    consumeLine,
    reservations,
    allocations,
  );
  await ledgerService.recordTransactions(transactions, tx);

  await applyConsumeAllocations(tx, tenantId, reservations, allocations);
  await finalizeConsumeLineAndRequisitions(
    tx,
    tenantId,
    consumeLine,
    reservations,
    allocations,
  );

  const updated = await tx.partsReservation.findFirst({
    where: { id: reservationId, tenant_id: tenantId },
  });
  if (!updated) throw new NotFoundException('Parts reservation not found');
  return toReservationResponse(updated);
}
