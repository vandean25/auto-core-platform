import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationKind,
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
} from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import type { AtpService } from '../inventory/atp.service.js';
import type { CreatePartsReservationDto } from './dto/create-parts-reservation.dto.js';
import type { CreatePartsRequisitionDto } from './dto/create-parts-requisition.dto.js';
import type { PartsRequisitionResponseDto } from './dto/parts-requisition-response.dto.js';
import type { PartsReservationResponseDto } from './dto/parts-reservation-response.dto.js';
import { requireCatalogItemId } from './parts-requisition.helpers.js';
import {
  lockRequisitionLine,
  lockRequisitionLines,
  lockRequisitionReservations,
  lockRequisitionStock,
  lockRequisitionTask,
  lockRequisitionTasks,
} from './parts-requisition-lifecycle.locking.js';
import {
  loadRequisitionResponse,
  toReservationResponse,
} from './parts-requisition-lifecycle.mappers.js';
import {
  findAuthorizedLine,
  findAuthorizedSourceLocation,
  findLineReservations,
  findRequisitionCandidateLines,
} from './parts-requisition-lifecycle.queries.js';
import {
  assertLineAllocationFits,
  groupReservationsByLine,
} from './parts-requisition-lifecycle.validation.js';

export async function incrementTaskVersions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskIds: readonly string[],
): Promise<void> {
  if (taskIds.length === 0) {
    return;
  }
  const result = await tx.workshopTask.updateMany({
    where: { tenant_id: tenantId, id: { in: [...taskIds] } },
    data: { line_items_version: { increment: 1 } },
  });
  if (result.count !== taskIds.length) {
    throw new ConflictException(
      'Workshop task changed while building the requisition. Please retry.',
    );
  }
}

export async function executeCreateOnHandReservation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  dto: CreatePartsReservationDto,
  atpService: AtpService,
): Promise<PartsReservationResponseDto> {
  const quantity = new Prisma.Decimal(dto.quantity);
  const initialLine = await findAuthorizedLine(
    tx,
    tenantId,
    siteId,
    dto.workshopTaskLineItemId,
  );
  if (!initialLine) {
    throw new UnprocessableEntityException(
      'Workshop task line is not available in the active site.',
    );
  }
  requireCatalogItemId(initialLine);

  const location = await findAuthorizedSourceLocation(
    tx,
    tenantId,
    siteId,
    dto.locationId,
  );
  if (!location) {
    throw new UnprocessableEntityException(
      'Source location is not available in the active site.',
    );
  }

  await lockRequisitionTask(tx, tenantId, initialLine.workshop_task_id);
  const line = await findAuthorizedLine(
    tx,
    tenantId,
    siteId,
    dto.workshopTaskLineItemId,
  );
  if (!line) {
    throw new UnprocessableEntityException(
      'Workshop task line is not available in the active site.',
    );
  }
  const catalogItemId = requireCatalogItemId(line);

  await lockRequisitionLine(tx, tenantId, line.id);
  const existingReservations = await findLineReservations(
    tx,
    tenantId,
    line.id,
  );
  await lockRequisitionReservations(
    tx,
    tenantId,
    existingReservations.map((reservation) => reservation.id),
  );

  const stock = await tx.inventoryStock.findFirst({
    where: {
      tenant_id: tenantId,
      catalog_item_id: catalogItemId,
      location_id: location.id,
      site_id: location.site_id,
    },
    select: { id: true, site_id: true },
  });
  if (!stock) {
    throw new UnprocessableEntityException(
      'No inventory stock exists for this part at the source location.',
    );
  }

  await lockRequisitionStock(tx, tenantId, stock.id);
  assertLineAllocationFits(line.quantity, existingReservations, quantity);

  await atpService.reserveOnHand({ stockId: stock.id, quantity }, tx);

  const reservation = await tx.partsReservation.create({
    data: {
      tenant_id: tenantId,
      workshop_task_line_item_id: line.id,
      quantity,
      kind: PartsReservationKind.ON_HAND,
      status: PartsReservationStatus.OPEN,
      location_id: location.id,
    },
  });

  const versionUpdate = await tx.workshopTask.updateMany({
    where: { id: line.workshop_task_id, tenant_id: tenantId },
    data: { line_items_version: { increment: 1 } },
  });
  if (versionUpdate.count === 0) {
    throw new ConflictException(
      'Workshop task changed while reserving parts. Please retry.',
    );
  }

  return toReservationResponse(reservation);
}

export async function executeCreateRequisitionSheet(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  dto: CreatePartsRequisitionDto,
): Promise<PartsRequisitionResponseDto> {
  const brand = await tx.brand.findFirst({
    where: {
      id: dto.vehicleMakeBrandId,
      tenant_id: tenantId,
      isVehicleMake: true,
    },
    select: { id: true },
  });
  if (!brand) {
    throw new UnprocessableEntityException(
      'Vehicle-make brand is not available.',
    );
  }

  const lineIds = dto.items.map((item) => item.workshopTaskLineItemId);
  const lines = await findRequisitionCandidateLines(
    tx,
    tenantId,
    siteId,
    lineIds,
  );
  if (lines.length !== lineIds.length) {
    throw new UnprocessableEntityException(
      'One or more workshop part lines are not available in the active site.',
    );
  }

  const taskIds = [
    ...new Set(lines.map((line) => line.workshop_task_id)),
  ].sort();
  await lockRequisitionTasks(tx, tenantId, taskIds);
  await lockRequisitionLines(
    tx,
    tenantId,
    lines.map((line) => line.id),
  );

  const reservations = await tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      workshop_task_line_item_id: { in: lineIds },
    },
    select: {
      id: true,
      tenant_id: true,
      workshop_task_line_item_id: true,
      quantity: true,
      quantity_received: true,
      quantity_consumed: true,
      quantity_staged: true,
      quantity_returned: true,
      kind: true,
      status: true,
      location_id: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { id: 'asc' },
  });
  await lockRequisitionReservations(
    tx,
    tenantId,
    reservations.map((reservation) => reservation.id),
  );

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const reservationsByLine = groupReservationsByLine(reservations);

  for (const item of dto.items) {
    const line = lineById.get(item.workshopTaskLineItemId);
    if (!line) {
      throw new UnprocessableEntityException(
        'Selected workshop part line is not available.',
      );
    }
    if (
      line.workshop_task.workshop_order.vehicle.make_brand_id !==
      dto.vehicleMakeBrandId
    ) {
      throw new UnprocessableEntityException(
        'Selected workshop part line belongs to a different vehicle make.',
      );
    }
    assertLineAllocationFits(
      line.quantity,
      reservationsByLine.get(line.id) ?? [],
      new Prisma.Decimal(item.quantity),
    );
  }

  const requisition = await tx.partsRequisition.create({
    data: {
      tenant_id: tenantId,
      vehicle_make_brand_id: dto.vehicleMakeBrandId,
      status: PartsRequisitionStatus.DRAFT,
    },
    select: { id: true },
  });

  await chunkedPromiseAll(dto.items, async (item) => {
    const requisitionLine = await tx.partsRequisitionLine.create({
      data: {
        tenant_id: tenantId,
        requisition_id: requisition.id,
      },
      select: { id: true },
    });

    await tx.partsReservation.create({
      data: {
        tenant_id: tenantId,
        workshop_task_line_item_id: item.workshopTaskLineItemId,
        quantity: new Prisma.Decimal(item.quantity),
        kind: PartsReservationKind.REQUISITION,
        status: PartsReservationStatus.OPEN,
        requisition_line_id: requisitionLine.id,
      },
    });
  });

  await incrementTaskVersions(tx, tenantId, taskIds);
  return loadRequisitionResponse(tx, tenantId, requisition.id);
}
