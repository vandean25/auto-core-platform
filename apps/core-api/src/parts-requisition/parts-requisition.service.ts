import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { AtpService } from '../inventory/atp.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartsReservationDto } from './dto/create-parts-reservation.dto';
import { PartsReservationResponseDto } from './dto/parts-reservation-response.dto';
import { PartsShortageResponseDto } from './dto/parts-shortage-response.dto';
import { PartsShortagesQueryDto } from './dto/parts-shortages-query.dto';

const OPEN_WORKSHOP_ORDER_STATUSES = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
] as const;

const ACTIVE_RESERVATION_STATUSES = [
  PartsReservationStatus.OPEN,
  PartsReservationStatus.ORDERED,
  PartsReservationStatus.STAGED,
] as const;

const ACTIVE_RESERVATION_STATUS_SET = new Set<PartsReservationStatus>(
  ACTIVE_RESERVATION_STATUSES,
);

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
      stagingLocation: { site_id: string };
    };
  };
};

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
            status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
            ...(query.workshopOrderId ? { id: query.workshopOrderId } : {}),
            stagingLocation: {
              tenant_id: tenantId,
              site_id: siteId,
              deletedAt: null,
              site: { is_active: true },
            },
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
                stagingLocation: { select: { site_id: true } },
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
        catalog_item_id: { not: null },
        workshop_task: {
          tenant_id: tenantId,
          workshop_order: {
            tenant_id: tenantId,
            status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
            stagingLocation: {
              tenant_id: tenantId,
              site_id: siteId,
              deletedAt: null,
              site: { is_active: true },
            },
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
      if (!this.isActiveReservation(reservation)) {
        return sum;
      }

      return sum.add(this.getRemainingCommitment(reservation));
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

  private isActiveReservation(
    reservation: Pick<
      ReservationRow,
      | 'status'
      | 'quantity'
      | 'quantity_consumed'
      | 'quantity_returned'
      | 'quantity_staged'
    >,
  ): boolean {
    if (!ACTIVE_RESERVATION_STATUS_SET.has(reservation.status)) {
      return false;
    }

    return (
      this.getRemainingCommitment(reservation).gt(ZERO) ||
      new Prisma.Decimal(reservation.quantity_staged).gt(ZERO)
    );
  }

  private getRemainingCommitment(
    reservation: Pick<
      ReservationRow,
      'quantity' | 'quantity_consumed' | 'quantity_returned'
    >,
  ): Prisma.Decimal {
    const remaining = new Prisma.Decimal(reservation.quantity)
      .sub(reservation.quantity_consumed)
      .sub(reservation.quantity_returned);
    return remaining.gt(ZERO) ? remaining : ZERO;
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
        if (!this.isActiveReservation(reservation)) {
          return sum;
        }

        return sum.add(this.getRemainingCommitment(reservation));
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
      siteId: line.workshop_task.workshop_order.stagingLocation.site_id,
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
