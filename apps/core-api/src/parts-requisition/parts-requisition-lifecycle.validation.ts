import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
} from '@prisma/client';
import {
  getRemainingCommitment,
  isActiveSlice,
} from './parts-requisition.helpers.js';
import {
  type RequisitionCatalogItemWithBrand,
  type ReservationRow,
  ZERO,
} from './parts-requisition-lifecycle.types.js';

export function assertUniqueSelections(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new UnprocessableEntityException(
      'Duplicate selections are not allowed.',
    );
  }
}

export function groupReservationsByLine(
  reservations: readonly ReservationRow[],
): Map<string, ReservationRow[]> {
  const byLine = new Map<string, ReservationRow[]>();
  for (const reservation of reservations) {
    const bucket = byLine.get(reservation.workshop_task_line_item_id);
    if (bucket) {
      bucket.push(reservation);
    } else {
      byLine.set(reservation.workshop_task_line_item_id, [reservation]);
    }
  }
  return byLine;
}

export function assertLineAllocationFits(
  lineQuantity: Prisma.Decimal,
  reservations: readonly ReservationRow[],
  requestedQuantity: Prisma.Decimal,
): void {
  const consumedQuantity = reservations.reduce(
    (sum, reservation) =>
      sum.add(new Prisma.Decimal(reservation.quantity_consumed)),
    ZERO,
  );
  const activeCommitment = reservations.reduce((sum, reservation) => {
    if (!isActiveSlice(reservation)) {
      return sum;
    }

    return sum.add(getRemainingCommitment(reservation));
  }, ZERO);

  if (
    consumedQuantity
      .add(activeCommitment)
      .add(requestedQuantity)
      .gt(lineQuantity)
  ) {
    throw new ConflictException(
      'Reservation quantity exceeds the workshop line quantity.',
    );
  }
}

function assertReservationEligibleForPoItem(
  reservation: {
    id: string;
    kind: PartsReservationKind;
    status: PartsReservationStatus;
    purchase_order_item_id: string | null;
    requisition_line?: { requisition_id: string } | null;
    workshop_task_line_item: {
      catalog_item_id: string | null;
      workshop_task: {
        workshop_order: { site_id: string | null };
      };
    };
  },
  requisitionId: string,
  siteId: string,
  catalogItemById: Map<string, RequisitionCatalogItemWithBrand>,
  vendor: {
    name: string;
    supportedBrands: Array<{ id: number; name: string }>;
  },
): void {
  if (
    reservation.kind !== PartsReservationKind.REQUISITION ||
    reservation.requisition_line?.requisition_id !== requisitionId
  ) {
    throw new UnprocessableEntityException(
      'Reservation slice does not belong to this requisition.',
    );
  }
  if (
    reservation.workshop_task_line_item.workshop_task.workshop_order
      .site_id !== siteId
  ) {
    throw new UnprocessableEntityException(
      'Reservation slice is not available in the active site.',
    );
  }
  if (
    reservation.status !== PartsReservationStatus.OPEN &&
    reservation.status !== PartsReservationStatus.ORDERED
  ) {
    throw new UnprocessableEntityException(
      'Only open or ordered slices can be added to a purchase order.',
    );
  }
  if (reservation.purchase_order_item_id) {
    throw new ConflictException(
      'Reservation slice is already linked to a purchase order item.',
    );
  }
  const catalogItemId = reservation.workshop_task_line_item.catalog_item_id;
  if (!catalogItemId) {
    throw new UnprocessableEntityException(
      'Reservation slice has no catalog item.',
    );
  }
  const catalogItem = catalogItemById.get(catalogItemId);
  if (!catalogItem) {
    throw new UnprocessableEntityException(
      'Catalog item for the reservation slice is not available.',
    );
  }
  if (
    catalogItem.brand &&
    !vendor.supportedBrands.some(
      (brand: { id: number }) => brand.id === catalogItem.brand_id,
    )
  ) {
    throw new BadRequestException(
      `Vendor ${vendor.name} does not support brand ${catalogItem.brand.name}.`,
    );
  }
}

export async function validateRequisitionPoItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  requisitionId: string,
  dtoItems: Array<{ reservationId: string; unitCost: string | number }>,
  vendor: {
    id: string;
    name: string;
    supportedBrands: Array<{ id: number; name: string }>;
  },
  reservations: Array<{
    id: string;
    quantity: Prisma.Decimal;
    status: PartsReservationStatus;
    kind: PartsReservationKind;
    purchase_order_item_id: string | null;
    requisition_line?: { requisition_id: string } | null;
    workshop_task_line_item: {
      catalog_item_id: string | null;
      workshop_task: {
        workshop_order: { site_id: string | null };
      };
    };
  }>,
): Promise<Map<string, RequisitionCatalogItemWithBrand>> {
  const reservationById = new Map(
    reservations.map((reservation) => [reservation.id, reservation]),
  );

  const catalogItemIds = [
    ...new Set(
      reservations
        .map(
          (reservation) => reservation.workshop_task_line_item.catalog_item_id,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const catalogItems =
    catalogItemIds.length === 0
      ? []
      : await tx.catalogItem.findMany({
          where: { tenant_id: tenantId, id: { in: catalogItemIds } },
          include: { brand: true },
        });
  const catalogItemById = new Map(
    catalogItems.map((catalogItem) => [catalogItem.id, catalogItem]),
  );

  for (const item of dtoItems) {
    const reservation = reservationById.get(item.reservationId);
    if (!reservation) {
      throw new UnprocessableEntityException(
        'Reservation slice was not found.',
      );
    }
    assertReservationEligibleForPoItem(
      reservation,
      requisitionId,
      siteId,
      catalogItemById,
      vendor,
    );
  }

  return catalogItemById;
}
