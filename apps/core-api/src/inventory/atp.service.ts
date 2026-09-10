import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
} from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

type DecimalQuantity = Prisma.Decimal | number | string;
type AtpTransactionClient = PrismaService | Prisma.TransactionClient;

export interface AtpMutationParams {
  stockId: string;
  quantity: DecimalQuantity;
}

export interface AtpStockInput {
  id?: string;
  locationId?: string;
  quantity_on_hand: DecimalQuantity;
  quantity_reserved: DecimalQuantity;
}

export interface AtpTotals {
  quantityOnHand: Prisma.Decimal;
  quantityReserved: Prisma.Decimal;
  quantityAvailable: Prisma.Decimal;
}

interface AtpContext {
  operation: string;
  stockId?: string;
  locationId?: string;
  tenantId?: string;
  siteId?: string;
  expected?: string;
  actual?: string;
}

interface AtpRequestContext {
  tenantId: string;
  siteId: string;
}

interface MutationStock {
  id: string;
  location_id: string;
  quantity_on_hand: Prisma.Decimal;
  quantity_reserved: Prisma.Decimal;
}

const STOCK_SELECT = {
  id: true,
  location_id: true,
  quantity_on_hand: true,
  quantity_reserved: true,
} as const;

const RECONCILIATION_STOCK_SELECT = {
  ...STOCK_SELECT,
  catalog_item_id: true,
} as const;

@Injectable()
export class AtpService {
  private readonly logger = new Logger(AtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async reserveOnHand(
    params: AtpMutationParams,
    prismaVal?: Prisma.TransactionClient,
  ): Promise<void> {
    const quantity = this.parsePositiveQuantity(params.quantity);
    const context = await this.getRequestContext();
    const tx = prismaVal ?? this.prisma;
    const stock = await this.findMutationStock(tx, params.stockId, context);

    this.calculateAtp(stock, {
      operation: 'reserve_on_hand',
      stockId: stock.id,
      locationId: stock.location_id,
      ...context,
    });

    // eslint-disable-next-line no-restricted-syntax -- ADR-locked parameterized ATP mutation; every predicate is tenant and site qualified.
    const affectedRows = await tx.$executeRaw`
      UPDATE inventory_stocks AS stock
      SET quantity_reserved = quantity_reserved + ${quantity}
      FROM storage_locations AS location
      WHERE stock.id = ${params.stockId}
        AND stock.tenant_id = ${context.tenantId}
        AND stock.location_id = location.id
        AND location.tenant_id = ${context.tenantId}
        AND location.site_id = ${context.siteId}
        AND location.type <> ${LocationType.staging_tote}::"LocationType"
        AND stock.quantity_on_hand - stock.quantity_reserved >= ${quantity}
    `;

    if (affectedRows === 0) {
      throw new ConflictException(
        `Insufficient ATP for inventory stock ${params.stockId}`,
      );
    }
  }

  async releaseOnHand(
    params: AtpMutationParams,
    prismaVal?: Prisma.TransactionClient,
  ): Promise<void> {
    const quantity = this.parsePositiveQuantity(params.quantity);
    const context = await this.getRequestContext();
    const tx = prismaVal ?? this.prisma;
    const stock = await this.findMutationStock(tx, params.stockId, context);

    this.calculateAtp(stock, {
      operation: 'release_on_hand',
      stockId: stock.id,
      locationId: stock.location_id,
      ...context,
    });

    // eslint-disable-next-line no-restricted-syntax -- ADR-locked parameterized ATP mutation; every predicate is tenant and site qualified.
    const affectedRows = await tx.$executeRaw`
      UPDATE inventory_stocks AS stock
      SET quantity_reserved = quantity_reserved - ${quantity}
      FROM storage_locations AS location
      WHERE stock.id = ${params.stockId}
        AND stock.tenant_id = ${context.tenantId}
        AND stock.location_id = location.id
        AND location.tenant_id = ${context.tenantId}
        AND location.site_id = ${context.siteId}
        AND location.type <> ${LocationType.staging_tote}::"LocationType"
        AND stock.quantity_reserved >= ${quantity}
    `;

    if (affectedRows === 0) {
      throw new ConflictException(
        `Cannot release more than reserved quantity for inventory stock ${params.stockId}`,
      );
    }
  }

  async reconcileStock(
    stockId: string,
    prismaVal?: Prisma.TransactionClient,
  ): Promise<void> {
    const context = await this.getRequestContext();
    const tx = prismaVal ?? this.prisma;
    const stock = await tx.inventoryStock.findFirst({
      where: this.buildStockWhere(stockId, context),
      select: RECONCILIATION_STOCK_SELECT,
    });

    if (!stock) {
      throw new BadRequestException(
        `Inventory stock ${stockId} is not available in the active site`,
      );
    }

    this.calculateAtp(stock, {
      operation: 'reconcile_stock',
      stockId: stock.id,
      locationId: stock.location_id,
      ...context,
    });

    const activeReservations = await tx.partsReservation.findMany({
      where: {
        tenant_id: context.tenantId,
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: stock.location_id,
        workshop_task_line_item: {
          tenant_id: context.tenantId,
          catalog_item_id: stock.catalog_item_id,
        },
      },
      select: { quantity: true },
    });

    const reservedBySlices = activeReservations.reduce(
      (sum, reservation) => sum.add(new Prisma.Decimal(reservation.quantity)),
      new Prisma.Decimal(0),
    );
    const cachedReserved = new Prisma.Decimal(stock.quantity_reserved);

    if (!cachedReserved.equals(reservedBySlices)) {
      this.logInvariantFailure({
        operation: 'reconcile_stock',
        stockId: stock.id,
        locationId: stock.location_id,
        tenantId: context.tenantId,
        siteId: context.siteId,
        expected: reservedBySlices.toString(),
        actual: cachedReserved.toString(),
      });
      throw new InternalServerErrorException(
        `Inventory reservation invariant failed for stock ${stock.id}`,
      );
    }
  }

  calculateAtp(stock: AtpStockInput, context: AtpContext): AtpTotals {
    const quantityOnHand = new Prisma.Decimal(stock.quantity_on_hand);
    const quantityReserved = new Prisma.Decimal(stock.quantity_reserved);
    const quantityAvailable = quantityOnHand.sub(quantityReserved);

    if (quantityAvailable.lt(0)) {
      this.logInvariantFailure({
        ...context,
        stockId: stock.id ?? context.stockId,
        locationId: stock.locationId ?? context.locationId,
        actual: quantityAvailable.toString(),
      });
      throw new InternalServerErrorException(
        'Inventory ATP invariant failed: quantity available is negative',
      );
    }

    return {
      quantityOnHand,
      quantityReserved,
      quantityAvailable,
    };
  }

  sumAtp(stocks: readonly AtpStockInput[], context: AtpContext): AtpTotals {
    return stocks.reduce(
      (totals, stock) => {
        const stockTotals = this.calculateAtp(stock, {
          ...context,
          stockId: stock.id ?? context.stockId,
          locationId: stock.locationId ?? context.locationId,
        });

        return {
          quantityOnHand: totals.quantityOnHand.add(stockTotals.quantityOnHand),
          quantityReserved: totals.quantityReserved.add(
            stockTotals.quantityReserved,
          ),
          quantityAvailable: totals.quantityAvailable.add(
            stockTotals.quantityAvailable,
          ),
        };
      },
      {
        quantityOnHand: new Prisma.Decimal(0),
        quantityReserved: new Prisma.Decimal(0),
        quantityAvailable: new Prisma.Decimal(0),
      },
    );
  }

  private async getRequestContext(): Promise<AtpRequestContext> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return { tenantId, siteId };
  }

  private async findMutationStock(
    tx: AtpTransactionClient,
    stockId: string,
    context: AtpRequestContext,
  ): Promise<MutationStock> {
    const stock = await tx.inventoryStock.findFirst({
      where: this.buildStockWhere(stockId, context),
      select: STOCK_SELECT,
    });

    if (!stock) {
      throw new BadRequestException(
        `Inventory stock ${stockId} is not available in the active site`,
      );
    }

    return stock;
  }

  private buildStockWhere(stockId: string, context: AtpRequestContext) {
    return {
      id: stockId,
      tenant_id: context.tenantId,
      location: {
        tenant_id: context.tenantId,
        site_id: context.siteId,
        type: { not: LocationType.staging_tote },
      },
    } as const;
  }

  private parsePositiveQuantity(quantity: DecimalQuantity): Prisma.Decimal {
    const parsedQuantity = new Prisma.Decimal(quantity);
    if (parsedQuantity.lte(0)) {
      throw new BadRequestException('ATP quantity must be greater than zero');
    }
    return parsedQuantity;
  }

  private logInvariantFailure(context: AtpContext): void {
    this.logger.error(
      JSON.stringify({
        type: 'inventory_invariant_failure',
        invariant:
          context.operation === 'reconcile_stock'
            ? 'quantity_reserved_reconciliation'
            : 'atp_negative',
        ...context,
      }),
    );
  }
}
