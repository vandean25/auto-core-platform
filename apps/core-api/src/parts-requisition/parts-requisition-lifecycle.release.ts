import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
  TransactionType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import type { AtpService } from '../inventory/atp.service.js';
import type { LedgerService } from '../inventory/ledger.service.js';
import type { ReleasePartsReservationDto } from './dto/release-parts-reservation.dto.js';
import type { PartsReservationResponseDto } from './dto/parts-reservation-response.dto.js';
import {
  getRemainingCommitment,
  isActiveSlice,
  recomputeRequisitionStatus,
} from './parts-requisition.helpers.js';
import {
  lockRequisitionLine,
  lockRequisitionReservations,
  lockRequisitionStock,
  lockRequisitionTask,
} from './parts-requisition-lifecycle.locking.js';
import { toReservationResponse } from './parts-requisition-lifecycle.mappers.js';
import { ZERO } from './parts-requisition-lifecycle.types.js';

export async function handleToteReturnStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  line: {
    catalog_item_id: string | null;
    workshop_task: {
      workshop_order: { staging_location_id: string | null };
    };
  },
  reservation: {
    id: string;
    tote_cost_basis?: Prisma.Decimal | null;
  },
  staged: Prisma.Decimal,
  returnLocationId: string | undefined,
  ledgerService: LedgerService,
): Promise<void> {
  if (!returnLocationId) {
    throw new UnprocessableEntityException(
      'returnLocationId is required when staged quantity is present.',
    );
  }
  const returnLocation = await tx.storageLocation.findFirst({
    where: {
      id: returnLocationId,
      tenant_id: tenantId,
      site_id: siteId,
      deletedAt: null,
      type: LocationType.bin,
      site: { is_active: true },
    },
    select: { id: true },
  });
  if (!returnLocation) {
    throw new UnprocessableEntityException(
      'Return location is not available in the active site.',
    );
  }
  const toteId = line.workshop_task.workshop_order.staging_location_id;
  if (!toteId || !line.catalog_item_id) {
    throw new UnprocessableEntityException(
      'Reservation line is not linked to a job tote.',
    );
  }
  await ledgerService.recordTransactions(
    [
      {
        itemId: line.catalog_item_id,
        locationId: toteId,
        quantity: staged.negated(),
        type: TransactionType.TRANSFER_OUT,
        referenceId: `WO-RELEASE-${reservation.id}`,
        costBasis: reservation.tote_cost_basis,
        partsReservationId: reservation.id,
      },
      {
        itemId: line.catalog_item_id,
        locationId: returnLocation.id,
        quantity: staged,
        type: TransactionType.TRANSFER_IN,
        referenceId: `WO-RELEASE-${reservation.id}`,
        costBasis: reservation.tote_cost_basis,
        partsReservationId: reservation.id,
      },
    ],
    tx,
  );
}

export async function loadAndLockReservationForRelease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  reservationId: string,
) {
  const reservation = await tx.partsReservation.findFirst({
    where: {
      tenant_id: tenantId,
      id: reservationId,
      status: {
        in: [
          PartsReservationStatus.OPEN,
          PartsReservationStatus.ORDERED,
          PartsReservationStatus.STAGED,
        ],
      },
      workshop_task_line_item: {
        workshop_task: { workshop_order: { site_id: siteId } },
      },
    },
    include: {
      workshop_task_line_item: {
        select: {
          id: true,
          workshop_task_id: true,
          catalog_item_id: true,
          workshop_task: {
            select: {
              workshop_order: { select: { staging_location_id: true } },
            },
          },
        },
      },
      requisition_line: { select: { requisition_id: true } },
    },
  });
  if (!reservation) {
    const fulfilled = await tx.partsReservation.findFirst({
      where: { tenant_id: tenantId, id: reservationId },
      select: { status: true },
    });
    if (fulfilled?.status === PartsReservationStatus.FULFILLED) {
      throw new UnprocessableEntityException(
        'Fulfilled reservations cannot be released.',
      );
    }
    throw new NotFoundException('Parts reservation not found');
  }

  const line = reservation.workshop_task_line_item;
  await lockRequisitionTask(tx, tenantId, line.workshop_task_id);
  await lockRequisitionLine(tx, tenantId, line.id);
  await lockRequisitionReservations(tx, tenantId, [reservation.id]);

  return reservation;
}

export async function releaseStagedReservationStock(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    siteId: string;
    line: {
      catalog_item_id: string | null;
      workshop_task: {
        workshop_order: { staging_location_id: string | null };
      };
    };
    reservation: {
      id: string;
      tote_cost_basis?: Prisma.Decimal | null;
    };
    staged: Prisma.Decimal;
    returnLocationId?: string | null;
    ledgerService: LedgerService;
  },
): Promise<void> {
  if (params.staged.gt(0)) {
    await handleToteReturnStock(
      tx,
      params.tenantId,
      params.siteId,
      params.line,
      params.reservation,
      params.staged,
      params.returnLocationId ?? undefined,
      params.ledgerService,
    );
  }
}

export async function releaseOnHandReservationCommitment(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    siteId: string;
    line: { catalog_item_id: string | null };
    reservation: {
      kind: PartsReservationKind;
      status: PartsReservationStatus;
      location_id?: string | null;
      quantity: Prisma.Decimal | number | string;
      quantity_consumed: Prisma.Decimal | number | string;
      quantity_returned: Prisma.Decimal | number | string;
    };
    staged: Prisma.Decimal;
    atpService: AtpService;
  },
): Promise<void> {
  const { tenantId, siteId, line, reservation, staged, atpService } = params;
  if (
    reservation.kind !== PartsReservationKind.ON_HAND ||
    reservation.status !== PartsReservationStatus.OPEN
  ) {
    return;
  }

  const remainingOnHand = getRemainingCommitment(reservation).sub(staged);
  const quantityToRelease = remainingOnHand.gt(0) ? remainingOnHand : ZERO;
  if (
    !quantityToRelease.gt(0) ||
    !reservation.location_id ||
    !line.catalog_item_id
  ) {
    return;
  }

  const stock = await tx.inventoryStock.findFirst({
    where: {
      tenant_id: tenantId,
      catalog_item_id: line.catalog_item_id,
      location_id: reservation.location_id,
      site_id: siteId,
    },
    select: { id: true },
  });
  if (stock) {
    await lockRequisitionStock(tx, tenantId, stock.id);
    await atpService.releaseOnHand(
      { stockId: stock.id, quantity: quantityToRelease },
      tx,
    );
  }
}

export async function cancelReservationRecord(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservation: {
    id: string;
    status: PartsReservationStatus;
    quantity_staged: Prisma.Decimal | number | string;
    purchase_order_item_id?: string | null;
    detached_at?: Date | null;
  },
  staged: Prisma.Decimal,
): Promise<void> {
  const updated = await tx.partsReservation.updateMany({
    where: {
      tenant_id: tenantId,
      id: reservation.id,
      status: reservation.status,
      quantity_staged: reservation.quantity_staged,
    },
    data: {
      quantity_returned: { increment: staged },
      quantity_staged: 0,
      status: PartsReservationStatus.CANCELLED,
      ...(reservation.purchase_order_item_id && !reservation.detached_at
        ? { detached_at: new Date() }
        : {}),
    },
  });
  if (updated.count !== 1) {
    throw new ConflictException('Reservation changed during release.');
  }
}

export async function syncLineItemStatusAfterRelease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineId: string,
  workshopTaskId?: string,
): Promise<void> {
  const allReservations = await tx.partsReservation.findMany({
    where: { tenant_id: tenantId, workshop_task_line_item_id: lineId },
    select: {
      status: true,
      quantity: true,
      quantity_consumed: true,
      quantity_returned: true,
      quantity_staged: true,
    },
  });
  const consumed = allReservations.reduce(
    (sum, candidate) => sum.add(candidate.quantity_consumed),
    ZERO,
  );
  const hasActiveSlices = allReservations.some(isActiveSlice);
  if (!hasActiveSlices) {
    await tx.workshopTaskLineItem.updateMany({
      where: { tenant_id: tenantId, id: lineId },
      data: {
        quantity: consumed,
        part_execution_status: consumed.gt(0)
          ? WorkshopPartLineExecutionStatus.CONSUMED
          : WorkshopPartLineExecutionStatus.CANCELLED,
      },
    });
  } else {
    await tx.workshopTaskLineItem.updateMany({
      where: { tenant_id: tenantId, id: lineId },
      data: {
        part_execution_status: allReservations.some((slice) =>
          new Prisma.Decimal(slice.quantity_staged).gt(0),
        )
          ? WorkshopPartLineExecutionStatus.STAGED
          : WorkshopPartLineExecutionStatus.PENDING_PICK,
      },
    });
  }

  const taskId =
    workshopTaskId ??
    (
      await tx.workshopTaskLineItem.findFirst({
        where: { id: lineId, tenant_id: tenantId },
        select: { workshop_task_id: true },
      })
    )?.workshop_task_id;

  if (taskId) {
    const versionUpdate = await tx.workshopTask.updateMany({
      where: { id: taskId, tenant_id: tenantId },
      data: { line_items_version: { increment: 1 } },
    });
    if (versionUpdate.count !== 1) {
      throw new ConflictException(
        'Workshop task changed during release. Refresh and retry.',
      );
    }
  }
}

export async function syncRequisitionAfterRelease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requisitionId?: string | null,
): Promise<void> {
  if (requisitionId) {
    await recomputeRequisitionStatus(tx, tenantId, requisitionId);
  }
}

export async function executeReleaseReservation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  reservationId: string,
  dto: ReleasePartsReservationDto,
  atpService: AtpService,
  ledgerService: LedgerService,
): Promise<PartsReservationResponseDto> {
  const reservation = await loadAndLockReservationForRelease(
    tx,
    tenantId,
    siteId,
    reservationId,
  );
  const line = reservation.workshop_task_line_item;
  const staged = new Prisma.Decimal(reservation.quantity_staged);

  await releaseStagedReservationStock(tx, {
    tenantId,
    siteId,
    line,
    reservation,
    staged,
    returnLocationId: dto.returnLocationId,
    ledgerService,
  });
  await releaseOnHandReservationCommitment(tx, {
    tenantId,
    siteId,
    line,
    reservation,
    staged,
    atpService,
  });
  await cancelReservationRecord(tx, tenantId, reservation, staged);
  await syncLineItemStatusAfterRelease(
    tx,
    tenantId,
    line.id,
    line.workshop_task_id,
  );
  await syncRequisitionAfterRelease(
    tx,
    tenantId,
    reservation.requisition_line?.requisition_id,
  );

  const result = await tx.partsReservation.findFirst({
    where: { id: reservation.id, tenant_id: tenantId },
  });
  if (!result) throw new NotFoundException('Parts reservation not found');
  return toReservationResponse(result);
}
