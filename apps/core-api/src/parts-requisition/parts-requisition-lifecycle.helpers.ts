import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
  PurchaseOrderStatus,
  TransactionType,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { AtpService } from '../inventory/atp.service.js';
import type { LedgerService } from '../inventory/ledger.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { generatePurchaseOrderNumber } from '../purchase/purchase-order-number.util.js';
import type { PurchaseOrderWithRelations } from '../purchase/purchase.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import type { ConsumePartsReservationDto } from './dto/consume-parts-reservation.dto.js';
import type { CreatePartsReservationDto } from './dto/create-parts-reservation.dto.js';
import type { CreatePartsRequisitionDto } from './dto/create-parts-requisition.dto.js';
import type { CreateRequisitionPurchaseOrderDto } from './dto/create-requisition-purchase-order.dto.js';
import type { PartsRequisitionResponseDto } from './dto/parts-requisition-response.dto.js';
import type { PartsReservationResponseDto } from './dto/parts-reservation-response.dto.js';
import type { PartsShortageResponseDto } from './dto/parts-shortage-response.dto.js';
import type { PartsShortagesQueryDto } from './dto/parts-shortages-query.dto.js';
import type { ReleasePartsReservationDto } from './dto/release-parts-reservation.dto.js';
import {
  allocateStagedConsumption,
  getRemainingCommitment,
  isActiveSlice,
  recomputeRequisitionStatus,
} from './parts-requisition.helpers.js';

export const OPEN_WORKSHOP_ORDER_STATUSES = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
] as const;

export const REQUISITION_SLICE_STATUSES = [
  PartsReservationStatus.OPEN,
  PartsReservationStatus.ORDERED,
] as const;

export const ZERO = new Prisma.Decimal(0);

export type ReservationRow = {
  id: string;
  tenant_id: string;
  workshop_task_line_item_id: string;
  quantity: Prisma.Decimal;
  quantity_received?: Prisma.Decimal;
  quantity_consumed: Prisma.Decimal;
  quantity_staged: Prisma.Decimal;
  quantity_returned: Prisma.Decimal;
  kind: PartsReservationKind;
  status: PartsReservationStatus;
  location_id?: string | null;
  tote_cost_basis?: Prisma.Decimal | null;
  purchase_order_item_id?: string | null;
  requisition_line_id?: string | null;
  requisition_line?: { requisition_id: string } | null;
  detached_at?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ShortageLine = {
  id: string;
  workshop_task_id: string;
  item_no: string;
  description: string;
  quantity: Prisma.Decimal;
  parts_reservations: Array<{
    quantity: Prisma.Decimal;
    quantity_consumed: Prisma.Decimal;
    quantity_staged: Prisma.Decimal;
    quantity_returned: Prisma.Decimal;
    status: PartsReservationStatus;
  }>;
  workshop_task: {
    id: string;
    workshop_order: {
      id: string;
      order_number: string;
      site_id: string;
      vehicle: {
        make: string;
        make_brand_id: number | null;
      };
    };
  };
};

export type RequisitionCandidateLine = {
  id: string;
  workshop_task_id: string;
  quantity: Prisma.Decimal;
  workshop_task: {
    workshop_order: {
      id: string;
      order_number: string;
      vehicle: { make_brand_id: number | null };
    };
  };
};

export type RequisitionDetailLine = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  reservation: {
    id: string;
    workshop_task_line_item_id: string;
    quantity: Prisma.Decimal;
    status: PartsReservationStatus;
    purchase_order_item_id: string | null;
    createdAt: Date;
    updatedAt: Date;
    workshop_task_line_item: {
      item_no: string;
      description: string;
      workshop_task: {
        workshop_order: { id: string; order_number: string };
      };
    };
  } | null;
};

export type RequisitionDetail = {
  id: string;
  tenant_id: string;
  vehicle_make_brand_id: number;
  status: PartsRequisitionStatus;
  createdAt: Date;
  updatedAt: Date;
  lines: RequisitionDetailLine[];
};

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

export async function lockRequisitionRows(
  tx: Prisma.TransactionClient,
  tableName: 'workshop_tasks' | 'workshop_task_line_items',
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  const sortedIds = [...new Set(ids)].sort();
  if (sortedIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked sorted tenant-qualified row locks preserve reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM ${Prisma.raw(tableName)}
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionTask(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM workshop_tasks
    WHERE tenant_id = ${tenantId} AND id = ${taskId}
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionLine(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM workshop_task_line_items
    WHERE tenant_id = ${tenantId} AND id = ${lineId}
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionTasks(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskIds: readonly string[],
): Promise<void> {
  await lockRequisitionRows(tx, 'workshop_tasks', tenantId, taskIds);
}

export async function lockRequisitionLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineIds: readonly string[],
): Promise<void> {
  await lockRequisitionRows(tx, 'workshop_task_line_items', tenantId, lineIds);
}

export async function lockRequisitionReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservationIds: readonly string[],
): Promise<void> {
  if (reservationIds.length === 0) {
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM parts_reservations
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join([...reservationIds])})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockRequisitionStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stockId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ADR-locked tenant-qualified row lock preserves reservation lock ordering.
  await tx.$queryRaw`
    SELECT id
    FROM inventory_stocks
    WHERE tenant_id = ${tenantId} AND id = ${stockId}
    ORDER BY id
    FOR UPDATE
  `;
}

export async function findAuthorizedLine(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  lineId: string,
) {
  return tx.workshopTaskLineItem.findFirst({
    where: {
      id: lineId,
      tenant_id: tenantId,
      type: WorkshopLineItemType.PART,
      part_execution_status: {
        not: WorkshopPartLineExecutionStatus.CANCELLED,
      },
      catalog_item_id: { not: null },
      workshop_task: {
        tenant_id: tenantId,
        workshop_order: {
          tenant_id: tenantId,
          site_id: siteId,
          status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
          site: { is_active: true },
        },
      },
    },
    select: {
      id: true,
      workshop_task_id: true,
      catalog_item_id: true,
      quantity: true,
    },
  });
}

export async function findAuthorizedSourceLocation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  locationId: string,
) {
  return tx.storageLocation.findFirst({
    where: {
      id: locationId,
      tenant_id: tenantId,
      site_id: siteId,
      deletedAt: null,
      type: LocationType.bin,
      site: { is_active: true },
    },
    select: { id: true, site_id: true },
  });
}

export async function findLineReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineId: string,
): Promise<ReservationRow[]> {
  return tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      workshop_task_line_item_id: lineId,
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
}

export async function findRequisitionCandidateLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  lineIds: readonly string[],
): Promise<RequisitionCandidateLine[]> {
  return tx.workshopTaskLineItem.findMany({
    where: {
      tenant_id: tenantId,
      id: { in: [...lineIds] },
      type: WorkshopLineItemType.PART,
      part_execution_status: {
        not: WorkshopPartLineExecutionStatus.CANCELLED,
      },
      catalog_item_id: { not: null },
      workshop_task: {
        tenant_id: tenantId,
        workshop_order: {
          tenant_id: tenantId,
          site_id: siteId,
          status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
          site: { is_active: true },
        },
      },
    },
    select: {
      id: true,
      workshop_task_id: true,
      quantity: true,
      workshop_task: {
        select: {
          workshop_order: {
            select: {
              id: true,
              order_number: true,
              vehicle: { select: { make_brand_id: true } },
            },
          },
        },
      },
    },
  });
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

export type RequisitionCatalogItemWithBrand = {
  id: string;
  brand_id: number | null;
  brand: { id: number; name: string } | null;
};

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

  return catalogItemById;
}

export async function executeCreateRequisitionPurchaseOrder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  requisitionId: string,
  dto: CreateRequisitionPurchaseOrderDto,
  reservations: Array<{
    id: string;
    quantity: Prisma.Decimal;
    workshop_task_line_item: {
      catalog_item_id: string | null;
    };
  }>,
): Promise<PurchaseOrderWithRelations> {
  const reservationById = new Map(
    reservations.map((reservation) => [reservation.id, reservation]),
  );

  const purchaseOrder = await tx.purchaseOrder.create({
    data: {
      tenant_id: tenantId,
      site_id: siteId,
      vendor_id: dto.vendorId,
      order_number: generatePurchaseOrderNumber(),
      status: PurchaseOrderStatus.DRAFT,
    },
    select: { id: true },
  });

  await chunkedPromiseAll(dto.items, async (item) => {
    const reservation = reservationById.get(item.reservationId);
    if (!reservation?.workshop_task_line_item.catalog_item_id) {
      throw new UnprocessableEntityException(
        'Reservation slice has no catalog item.',
      );
    }

    const purchaseOrderItem = await tx.purchaseOrderItem.create({
      data: {
        tenant_id: tenantId,
        purchase_order_id: purchaseOrder.id,
        catalog_item_id: reservation.workshop_task_line_item.catalog_item_id,
        quantity: reservation.quantity,
        unit_cost: item.unitCost,
        quantity_received: 0,
      },
      select: { id: true },
    });

    const linked = await tx.partsReservation.updateMany({
      where: {
        tenant_id: tenantId,
        id: reservation.id,
        purchase_order_item_id: null,
        status: { in: [...REQUISITION_SLICE_STATUSES] },
      },
      data: { purchase_order_item_id: purchaseOrderItem.id },
    });
    if (linked.count !== 1) {
      throw new ConflictException(
        `Reservation slice ${reservation.id} changed while creating the purchase order.`,
      );
    }
  });

  await recomputeRequisitionStatus(tx, tenantId, requisitionId);

  const created = await tx.purchaseOrder.findFirst({
    where: { id: purchaseOrder.id, tenant_id: tenantId, site_id: siteId },
    include: {
      vendor: true,
      items: { include: { catalog_item: true } },
    },
  });
  if (!created) {
    throw new NotFoundException('Purchase order not found');
  }
  return created;
}

export async function executeCreatePurchaseOrderForRequisition(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  requisitionId: string,
  dto: CreateRequisitionPurchaseOrderDto,
): Promise<PurchaseOrderWithRelations> {
  await lockSitesAndAssertActive(tx, tenantId, [siteId]);

  const requisition = await tx.partsRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    select: { id: true, status: true },
  });
  if (!requisition) {
    throw new NotFoundException('Parts requisition not found');
  }
  if (
    requisition.status === PartsRequisitionStatus.CANCELLED ||
    requisition.status === PartsRequisitionStatus.COMPLETED
  ) {
    throw new UnprocessableEntityException(
      'A terminal parts requisition cannot create a purchase order.',
    );
  }

  const reservationIds = dto.items.map((item) => item.reservationId);
  const reservations = await tx.partsReservation.findMany({
    where: { tenant_id: tenantId, id: { in: reservationIds } },
    select: {
      id: true,
      quantity: true,
      status: true,
      kind: true,
      purchase_order_item_id: true,
      requisition_line: { select: { requisition_id: true } },
      workshop_task_line_item: {
        select: {
          catalog_item_id: true,
          workshop_task: {
            select: {
              workshop_order: { select: { site_id: true } },
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  if (reservations.length !== reservationIds.length) {
    throw new UnprocessableEntityException(
      'One or more reservation slices were not found.',
    );
  }

  await lockRequisitionReservations(tx, tenantId, reservationIds);

  const vendor = await tx.vendor.findFirst({
    where: { id: dto.vendorId, tenant_id: tenantId },
    include: { supportedBrands: true },
  });
  if (!vendor) {
    throw new NotFoundException('Vendor not found');
  }

  await validateRequisitionPoItems(
    tx,
    tenantId,
    siteId,
    requisitionId,
    dto.items,
    vendor,
    reservations,
  );

  return executeCreateRequisitionPurchaseOrder(
    tx,
    tenantId,
    siteId,
    requisitionId,
    dto,
    reservations,
  );
}

export function assertBackOfficeAccess(
  tenantContext: TenantContextService,
): void {
  const user = tenantContext.getAuthenticatedUser();
  if (user?.role === 'TECH') {
    throw new ForbiddenException(
      'Mechanic-mode sessions may not access parts reservation endpoints.',
    );
  }
}

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

export async function executeReleaseReservation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  reservationId: string,
  dto: ReleasePartsReservationDto,
  atpService: AtpService,
  ledgerService: LedgerService,
): Promise<PartsReservationResponseDto> {
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

  const staged = new Prisma.Decimal(reservation.quantity_staged);
  if (staged.gt(0)) {
    await handleToteReturnStock(
      tx,
      tenantId,
      siteId,
      line,
      reservation,
      staged,
      dto.returnLocationId,
      ledgerService,
    );
  }
  if (
    reservation.kind === PartsReservationKind.ON_HAND &&
    reservation.status === PartsReservationStatus.OPEN
  ) {
    const remainingOnHand = getRemainingCommitment(reservation).sub(staged);
    const quantityToRelease = remainingOnHand.gt(0) ? remainingOnHand : ZERO;
    if (
      quantityToRelease.gt(0) &&
      reservation.location_id &&
      line.catalog_item_id
    ) {
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
  }

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

  const allReservations = await tx.partsReservation.findMany({
    where: { tenant_id: tenantId, workshop_task_line_item_id: line.id },
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
      where: { tenant_id: tenantId, id: line.id },
      data: {
        quantity: consumed,
        part_execution_status: consumed.gt(0)
          ? WorkshopPartLineExecutionStatus.CONSUMED
          : WorkshopPartLineExecutionStatus.CANCELLED,
      },
    });
  } else {
    await tx.workshopTaskLineItem.updateMany({
      where: { tenant_id: tenantId, id: line.id },
      data: {
        part_execution_status: allReservations.some((slice) =>
          new Prisma.Decimal(slice.quantity_staged).gt(0),
        )
          ? WorkshopPartLineExecutionStatus.STAGED
          : WorkshopPartLineExecutionStatus.PENDING_PICK,
      },
    });
  }
  const requisitionId = reservation.requisition_line?.requisition_id;
  if (requisitionId) {
    await recomputeRequisitionStatus(tx, tenantId, requisitionId);
  }
  const versionUpdate = await tx.workshopTask.updateMany({
    where: { id: line.workshop_task_id, tenant_id: tenantId },
    data: { line_items_version: { increment: 1 } },
  });
  if (versionUpdate.count !== 1) {
    throw new ConflictException(
      'Workshop task changed during release. Refresh and retry.',
    );
  }

  const result = await tx.partsReservation.findFirst({
    where: { id: reservation.id, tenant_id: tenantId },
  });
  if (!result) throw new NotFoundException('Parts reservation not found');
  return toReservationResponse(result);
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

  await lockRequisitionTask(tx, tenantId, line.workshop_task_id);
  await lockRequisitionLine(tx, tenantId, line.id);
  const reservations = await tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      workshop_task_line_item_id: line.id,
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
  const transactions = allocations.map(
    ({ reservationId: id, quantity: value }) => {
      const reservation = reservations.find((candidate) => candidate.id === id);
      if (!reservation) {
        throw new ConflictException('Reservation changed during consumption.');
      }
      return {
        itemId: line.catalog_item_id as string,
        locationId: line.workshop_task.workshop_order
          .staging_location_id as string,
        quantity: new Prisma.Decimal(value).negated(),
        type: TransactionType.WORKSHOP_CONSUMPTION,
        referenceId: `WO-CONSUME-${line.id}-${id}`,
        costBasis: reservation.tote_cost_basis,
        partsReservationId: id,
      };
    },
  );
  await ledgerService.recordTransactions(transactions, tx);

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

  const updated = await tx.partsReservation.findFirst({
    where: { id: reservationId, tenant_id: tenantId },
  });
  if (!updated) throw new NotFoundException('Parts reservation not found');
  return toReservationResponse(updated);
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
  if (!line.catalog_item_id) {
    throw new UnprocessableEntityException(
      'Only catalog-backed part lines can be reserved.',
    );
  }

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
      catalog_item_id: line.catalog_item_id,
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

export async function fetchShortages(
  prisma: PrismaService,
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
