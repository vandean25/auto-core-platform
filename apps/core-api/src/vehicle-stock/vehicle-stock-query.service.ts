import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleInventoryRole,
  VehiclePurchaseStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { QueryBuilder } from '../common/utils/query-builder';
import { costBasis } from './vehicle-cost';
import type { PatchVehicleStockDto } from './dto/patch-vehicle-stock.dto';

const STOCK_SORT_WHITELIST = [
  'make',
  'model',
  'year',
  'vin',
  'plate',
  'color',
  'stock_status',
  'updatedAt',
];
const DRAFT_SORT_WHITELIST = STOCK_SORT_WHITELIST.filter(
  (field) => field !== 'stock_status',
);
const STOCK_STATUS_VALUES = new Set<string>(Object.values(VehicleStockStatus));
const DEFAULT_ORDER_BY = { updatedAt: 'desc' } as const;
const VEHICLE_LIST_INCLUDE = {
  reserved_for_customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      company_name: true,
      type: true,
    },
  },
  location: true,
} as const;

function isVehicleStockStatus(value: string): value is VehicleStockStatus {
  return STOCK_STATUS_VALUES.has(value);
}

function searchClause(search?: string) {
  if (!search) return {};
  return {
    OR: [
      { vin: { contains: search, mode: 'insensitive' as const } },
      { plate: { contains: search, mode: 'insensitive' as const } },
      { make: { contains: search, mode: 'insensitive' as const } },
      { model: { contains: search, mode: 'insensitive' as const } },
      { color: { contains: search, mode: 'insensitive' as const } },
    ],
  };
}

function concatPageWindow(
  firstCount: number,
  page: number,
  limit: number,
): {
  first: { skip: number; take: number };
  second: { skip: number; take: number };
} {
  const start = (page - 1) * limit;
  const end = start + limit;
  const firstStart = Math.min(start, firstCount);
  const firstEnd = Math.min(end, firstCount);
  return {
    first: { skip: firstStart, take: Math.max(0, firstEnd - firstStart) },
    second: {
      skip: Math.max(0, start - firstCount),
      take: Math.max(0, end - Math.max(start, firstCount)),
    },
  };
}

@Injectable()
export class VehicleStockQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(params: {
    search?: string;
    stock_status?: string;
    page?: number;
    limit?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = Math.min(
      params.limit && params.limit > 0 ? params.limit : 25,
      100,
    );
    const stockStatus = this.parseStockStatus(params.stock_status);
    const includeDrafts =
      !stockStatus || stockStatus === VehicleStockStatus.ON_ORDER;
    const sorting = params.sortField
      ? [{ field: params.sortField, direction: params.sortDirection ?? 'asc' }]
      : [];
    const vehicleOrderBy = QueryBuilder.buildOrderBy(
      sorting,
      STOCK_SORT_WHITELIST,
    ) ?? [DEFAULT_ORDER_BY];
    const draftOrderBy = QueryBuilder.buildOrderBy(
      sorting,
      DRAFT_SORT_WHITELIST,
    ) ?? [DEFAULT_ORDER_BY];

    const vehicleWhere: Prisma.VehicleWhereInput = {
      tenant_id: tenantId,
      inventory_role: {
        in: [
          VehicleInventoryRole.USED,
          VehicleInventoryRole.NEW,
          VehicleInventoryRole.DEMO,
        ],
      },
      ...(stockStatus ? { stock_status: stockStatus } : {}),
      ...searchClause(params.search),
    };
    const draftWhere: Prisma.VehiclePurchaseWhereInput = {
      tenant_id: tenantId,
      status: VehiclePurchaseStatus.DRAFT,
      ...searchClause(params.search),
    };

    const [vehicleTotal, draftTotal] = await Promise.all([
      this.prisma.vehicle.count({ where: vehicleWhere }),
      includeDrafts
        ? this.prisma.vehiclePurchase.count({ where: draftWhere })
        : 0,
    ]);
    const total = vehicleTotal + draftTotal;
    const window = concatPageWindow(
      includeDrafts ? draftTotal : 0,
      page,
      limit,
    );

    const emptyPurchases: Prisma.VehiclePurchaseGetPayload<object>[] = [];
    const emptyVehicles: Prisma.VehicleGetPayload<{
      include: typeof VEHICLE_LIST_INCLUDE;
    }>[] = [];
    const [drafts, vehicles] = await Promise.all([
      includeDrafts && window.first.take > 0
        ? this.prisma.vehiclePurchase.findMany({
            where: draftWhere,
            orderBy:
              draftOrderBy as Prisma.VehiclePurchaseOrderByWithRelationInput[],
            skip: window.first.skip,
            take: window.first.take,
          })
        : emptyPurchases,
      window.second.take > 0
        ? this.prisma.vehicle.findMany({
            where: vehicleWhere,
            include: VEHICLE_LIST_INCLUDE,
            orderBy: vehicleOrderBy as Prisma.VehicleOrderByWithRelationInput[],
            skip: window.second.skip,
            take: window.second.take,
          })
        : emptyVehicles,
    ]);

    return {
      data: [
        ...drafts.map((purchase) => ({
          id: purchase.id,
          draft_purchase_id: purchase.id,
          make: purchase.make,
          model: purchase.model,
          year: purchase.year,
          vin: purchase.vin,
          plate: purchase.plate,
          color: purchase.color,
          stock_status: VehicleStockStatus.ON_ORDER,
          inventory_role: VehicleInventoryRole.USED,
          mileage: purchase.mileage,
          location: null,
          reserved_for_customer: null,
          updatedAt: purchase.updatedAt,
        })),
        ...vehicles.map((vehicle) => ({
          ...vehicle,
          draft_purchase_id: null,
        })),
      ],
      meta: {
        total,
        page,
        limit,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
        pageCount: Math.ceil(total / limit),
      },
    };
  }

  private parseStockStatus(value?: string): VehicleStockStatus | undefined {
    if (!value) return undefined;
    if (!isVehicleStockStatus(value)) {
      throw new BadRequestException('Invalid stock_status');
    }
    return value;
  }

  async detail(vehicleId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      include: {
        reserved_for_customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            company_name: true,
            type: true,
          },
        },
        location: true,
        purchases: { orderBy: { createdAt: 'desc' } },
        sales: { orderBy: { createdAt: 'desc' } },
        ledger_entries: { orderBy: { createdAt: 'asc' } },
        workshop_orders: {
          where: { purpose: 'STOCK_PREP' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    return {
      ...vehicle,
      cost_basis: costBasis(vehicle.ledger_entries),
    };
  }

  async patch(vehicleId: string, dto: PatchVehicleStockDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
      throw new ConflictException(
        'Only used stock vehicles can be patched here',
      );
    }

    if (dto.location_id) {
      const location = await this.prisma.storageLocation.findFirst({
        where: { id: dto.location_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!location) {
        throw new NotFoundException(`Location ${dto.location_id} not found`);
      }
    }
    if (dto.reserved_for_customer_id) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.reserved_for_customer_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundException(
          `Customer ${dto.reserved_for_customer_id} not found`,
        );
      }
    }

    const data: Prisma.VehicleUncheckedUpdateManyInput = {
      location_id: dto.location_id === undefined ? undefined : dto.location_id,
      mileage: dto.mileage,
      color: dto.color,
      key_number: dto.key_number,
      registration_certificate_no: dto.registration_certificate_no,
    };

    const where: Prisma.VehicleWhereInput = {
      id: vehicleId,
      tenant_id: tenantId,
      inventory_role: VehicleInventoryRole.USED,
    };

    if (dto.reserved_for_customer_id === null) {
      data.reserved_for_customer_id = null;
      if (vehicle.stock_status === VehicleStockStatus.RESERVED) {
        data.stock_status = VehicleStockStatus.IN_STOCK;
        where.stock_status = VehicleStockStatus.RESERVED;
      }
    } else if (dto.reserved_for_customer_id) {
      data.reserved_for_customer_id = dto.reserved_for_customer_id;
      data.stock_status = VehicleStockStatus.RESERVED;
      where.stock_status = {
        in: [VehicleStockStatus.IN_STOCK, VehicleStockStatus.RESERVED],
      };
    }

    const updated = await this.prisma.vehicle.updateMany({
      where,
      data,
    });
    if (updated.count === 0) {
      throw new ConflictException(
        'Vehicle status changed concurrently and cannot be patched',
      );
    }

    return this.detail(vehicleId);
  }
}
