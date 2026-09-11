import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { SiteContextService } from '../common/services/site-context.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { AtpService } from '../inventory/atp.service';
import { generatePurchaseOrderNumber } from '../purchase/purchase-order-number.util';
import type { PurchaseOrderWithRelations } from '../purchase/purchase.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartsRequisitionDto } from './dto/create-parts-requisition.dto';
import { CreatePartsReservationDto } from './dto/create-parts-reservation.dto';
import { CreateRequisitionPurchaseOrderDto } from './dto/create-requisition-purchase-order.dto';
import { PartsRequisitionResponseDto } from './dto/parts-requisition-response.dto';
import { PartsReservationResponseDto } from './dto/parts-reservation-response.dto';
import { PartsShortageResponseDto } from './dto/parts-shortage-response.dto';
import { PartsShortagesQueryDto } from './dto/parts-shortages-query.dto';
import {
  getRemainingCommitment,
  isActiveSlice,
  recomputeRequisitionStatus,
} from './parts-requisition.helpers';

const OPEN_WORKSHOP_ORDER_STATUSES = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
] as const;

const REQUISITION_SLICE_STATUSES = [
  PartsReservationStatus.OPEN,
  PartsReservationStatus.ORDERED,
] as const;

const ZERO = new Prisma.Decimal(0);

type ReservationRow = {
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
  createdAt: Date;
  updatedAt: Date;
};

type ShortageLine = {
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

type RequisitionCandidateLine = {
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

type RequisitionDetailLine = {
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

type RequisitionDetail = {
  id: string;
  tenant_id: string;
  vehicle_make_brand_id: number;
  status: PartsRequisitionStatus;
  createdAt: Date;
  updatedAt: Date;
  lines: RequisitionDetailLine[];
};

function groupReservationsByLine(
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

@Injectable()
export class PartsRequisitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly atpService: AtpService,
  ) {}

  async createOnHandReservation(
    dto: CreatePartsReservationDto,
  ): Promise<PartsReservationResponseDto> {
    this.assertBackOfficeAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const quantity = new Prisma.Decimal(dto.quantity);

    return this.prisma.$transaction(async (tx) => {
      const initialLine = await this.findAuthorizedLine(
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

      const location = await this.findAuthorizedSourceLocation(
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

      await this.lockTask(tx, tenantId, initialLine.workshop_task_id);
      const line = await this.findAuthorizedLine(
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

      await this.lockLine(tx, tenantId, line.id);
      const existingReservations = await this.findLineReservations(
        tx,
        tenantId,
        line.id,
      );
      await this.lockReservations(
        tx,
        tenantId,
        existingReservations.map((reservation) => reservation.id),
      );

      const stock = await tx.inventoryStock.findFirst({
        where: {
          tenant_id: tenantId,
          catalog_item_id: line.catalog_item_id,
          location_id: location.id,
        },
        select: { id: true },
      });
      if (!stock) {
        throw new UnprocessableEntityException(
          'No inventory stock exists for this part at the source location.',
        );
      }

      await this.lockStock(tx, tenantId, stock.id);
      this.assertLineAllocationFits(
        line.quantity,
        existingReservations,
        quantity,
      );

      await this.atpService.reserveOnHand({ stockId: stock.id, quantity }, tx);

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

      return this.toReservationResponse(reservation);
    });
  }

  async getShortages(query: PartsShortagesQueryDto): Promise<{
    data: PartsShortageResponseDto[];
    meta: Record<string, number>;
  }> {
    this.assertBackOfficeAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

    const lines = await this.prisma.workshopTaskLineItem.findMany({
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
      .map((line) => this.toShortageResponse(line as ShortageLine))
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

  private assertBackOfficeAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (user?.role === 'TECH') {
      throw new ForbiddenException(
        'Mechanic-mode sessions may not access parts reservation endpoints.',
      );
    }
  }

  async createRequisitionSheet(
    dto: CreatePartsRequisitionDto,
  ): Promise<PartsRequisitionResponseDto> {
    this.assertBackOfficeAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    this.assertUniqueSelections(
      dto.items.map((item) => item.workshopTaskLineItemId),
    );

    return this.prisma.$transaction(async (tx) => {
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
      const lines = await this.findRequisitionCandidateLines(
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
      await this.lockTasks(tx, tenantId, taskIds);
      await this.lockLines(
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
      await this.lockReservations(
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
        this.assertLineAllocationFits(
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

      await this.incrementTaskVersions(tx, tenantId, taskIds);
      return this.loadRequisitionResponse(tx, tenantId, requisition.id);
    });
  }

  async createPurchaseOrderForRequisition(
    requisitionId: string,
    dto: CreateRequisitionPurchaseOrderDto,
  ): Promise<PurchaseOrderWithRelations> {
    this.assertBackOfficeAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    this.assertUniqueSelections(dto.items.map((item) => item.reservationId));

    return this.prisma.$transaction(async (tx) => {
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
      const reservationById = new Map(
        reservations.map((reservation) => [reservation.id, reservation]),
      );
      if (reservationById.size !== reservationIds.length) {
        throw new UnprocessableEntityException(
          'One or more reservation slices were not found.',
        );
      }

      await this.lockReservations(tx, tenantId, reservationIds);

      const vendor = await tx.vendor.findFirst({
        where: { id: dto.vendorId, tenant_id: tenantId },
        include: { supportedBrands: true },
      });
      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      const catalogItemIds = [
        ...new Set(
          reservations
            .map(
              (reservation) =>
                reservation.workshop_task_line_item.catalog_item_id,
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

      for (const item of dto.items) {
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
        const catalogItemId =
          reservation.workshop_task_line_item.catalog_item_id;
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
            (brand) => brand.id === catalogItem.brand_id,
          )
        ) {
          throw new BadRequestException(
            `Vendor ${vendor.name} does not support brand ${catalogItem.brand.name}.`,
          );
        }
      }

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          tenant_id: tenantId,
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
            catalog_item_id:
              reservation.workshop_task_line_item.catalog_item_id,
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
        where: { id: purchaseOrder.id, tenant_id: tenantId },
        include: {
          vendor: true,
          items: { include: { catalog_item: true } },
        },
      });
      if (!created) {
        throw new NotFoundException('Purchase order not found');
      }
      return created;
    });
  }

  private assertUniqueSelections(ids: readonly string[]): void {
    if (new Set(ids).size !== ids.length) {
      throw new UnprocessableEntityException(
        'Duplicate selections are not allowed.',
      );
    }
  }

  private async findRequisitionCandidateLines(
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

  private async incrementTaskVersions(
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

  private async loadRequisitionResponse(
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

    return this.toRequisitionResponse(requisition);
  }

  private toRequisitionResponse(
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

  private async findAuthorizedLine(
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

  private async findAuthorizedSourceLocation(
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
      select: { id: true },
    });
  }

  private async findLineReservations(
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

  private assertLineAllocationFits(
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

  private toReservationResponse(
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
      quantityStaged: new Prisma.Decimal(
        reservation.quantity_staged,
      ).toString(),
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

  private toShortageResponse(
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
      vehicleMakeBrandId:
        line.workshop_task.workshop_order.vehicle.make_brand_id,
    };
  }

  private async lockTask(
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

  private async lockLine(
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

  private async lockTasks(
    tx: Prisma.TransactionClient,
    tenantId: string,
    taskIds: readonly string[],
  ): Promise<void> {
    await this.lockRows(tx, 'workshop_tasks', tenantId, taskIds);
  }

  private async lockLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lineIds: readonly string[],
  ): Promise<void> {
    await this.lockRows(tx, 'workshop_task_line_items', tenantId, lineIds);
  }

  private async lockRows(
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

  private async lockReservations(
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

  private async lockStock(
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
}
