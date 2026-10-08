import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleInventoryRole,
  VehiclePurchaseStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import { QueryBuilder } from '../common/utils/query-builder.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import {
  assertVehicleRegulatoryFields,
  normalizeVehicleRegulatoryFields,
} from '../vehicle/vehicle-regulatory.validation.js';
import { costBasis } from './vehicle-cost.js';
import { assertTenantCustomerExists } from './vehicle-stock-ref.validator.js';
import type { PatchVehicleStockDto } from './dto/patch-vehicle-stock.dto.js';
import type { GewaehrleistungDueListQueryDto } from './dto/gewaehrleistung-due-list.dto.js';

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
export const DEALER_INVENTORY_ROLES: readonly VehicleInventoryRole[] = [
  VehicleInventoryRole.USED,
  VehicleInventoryRole.NEW,
  VehicleInventoryRole.DEMO,
];
const DEFAULT_ORDER_BY = { updatedAt: 'desc' } as const;

const RESERVED_CUSTOMER_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  company_name: true,
  type: true,
} as const;

const VEHICLE_LIST_INCLUDE = {
  reserved_for_customer: {
    select: RESERVED_CUSTOMER_SELECT,
  },
  location: true,
} as const;

function isVehicleStockStatus(value: string): value is VehicleStockStatus {
  return STOCK_STATUS_VALUES.has(value);
}

function parseStockStatus(value?: string): VehicleStockStatus | undefined {
  if (!value) return undefined;
  if (!isVehicleStockStatus(value)) {
    throw new BadRequestException('Invalid stock_status');
  }
  return value;
}

function shouldIncludeDrafts(stockStatus?: VehicleStockStatus): boolean {
  return !stockStatus || stockStatus === VehicleStockStatus.ON_ORDER;
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

function parsePagination(params: { page?: number; limit?: number }) {
  const page = params.page && params.page > 0 ? params.page : 1;
  const limit = Math.min(
    params.limit && params.limit > 0 ? params.limit : 25,
    100,
  );
  return { page, limit };
}

function buildPaginationMeta(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    pageSize: limit,
    totalPages,
    pageCount: totalPages,
  };
}

function buildListOrderBy(sortField?: string, sortDirection?: 'asc' | 'desc') {
  const sorting = sortField
    ? [{ field: sortField, direction: sortDirection ?? 'asc' }]
    : [];
  return {
    vehicleOrderBy: (QueryBuilder.buildOrderBy(
      sorting,
      STOCK_SORT_WHITELIST,
    ) ?? [DEFAULT_ORDER_BY]) as Prisma.VehicleOrderByWithRelationInput[],
    draftOrderBy: (QueryBuilder.buildOrderBy(sorting, DRAFT_SORT_WHITELIST) ?? [
      DEFAULT_ORDER_BY,
    ]) as Prisma.VehiclePurchaseOrderByWithRelationInput[],
  };
}

export function buildVehicleListWhere(
  tenantId: string,
  siteId: string,
  stockStatus?: VehicleStockStatus,
  search?: string,
): {
  vehicleWhere: Prisma.VehicleWhereInput;
  draftWhere: Prisma.VehiclePurchaseWhereInput;
} {
  const searchFilter = searchClause(search);
  const vehicleWhere: Prisma.VehicleWhereInput = {
    tenant_id: tenantId,
    location: { site_id: siteId },
    inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
    ...(stockStatus ? { stock_status: stockStatus } : {}),
    ...searchFilter,
  };
  const draftWhere: Prisma.VehiclePurchaseWhereInput = {
    tenant_id: tenantId,
    site_id: siteId,
    status: VehiclePurchaseStatus.DRAFT,
    ...searchFilter,
  };
  return { vehicleWhere, draftWhere };
}

export function mapDraftVehiclePurchase(
  purchase: Prisma.VehiclePurchaseGetPayload<object>,
) {
  return {
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
  };
}

export function mapStockVehicle(
  vehicle: Prisma.VehicleGetPayload<{
    include: typeof VEHICLE_LIST_INCLUDE;
  }>,
) {
  return {
    ...stripVehicleIdentityResolutionState(vehicle),
    draft_purchase_id: null,
  };
}

export function validatePatchTransitions(
  vehicle: {
    inventory_role: VehicleInventoryRole;
    stock_status: VehicleStockStatus | null;
  } | null,
  vehicleId: string,
): asserts vehicle is {
  inventory_role: VehicleInventoryRole;
  stock_status: VehicleStockStatus | null;
} {
  if (!vehicle) {
    throw new NotFoundException(`Vehicle ${vehicleId} not found`);
  }
  if (!DEALER_INVENTORY_ROLES.includes(vehicle.inventory_role)) {
    throw new ConflictException(
      'Only dealer stock vehicles can be patched here',
    );
  }
}

function validateLotInput(dto: PatchVehicleStockDto): void {
  if (dto.location_id === null) {
    throw new UnprocessableEntityException(
      'A parked dealer vehicle must have a vehicle lot',
    );
  }
}

function applyReservationUpdate(
  where: Prisma.VehicleWhereInput,
  data: Prisma.VehicleUncheckedUpdateManyInput,
  currentStatus: VehicleStockStatus | null,
  reservedCustomerId?: string | null,
): void {
  if (reservedCustomerId === null) {
    data.reserved_for_customer_id = null;
    if (currentStatus === VehicleStockStatus.RESERVED) {
      data.stock_status = VehicleStockStatus.IN_STOCK;
      where.stock_status = VehicleStockStatus.RESERVED;
    }
  } else if (reservedCustomerId) {
    data.reserved_for_customer_id = reservedCustomerId;
    data.stock_status = VehicleStockStatus.RESERVED;
    where.stock_status = {
      in: [VehicleStockStatus.IN_STOCK, VehicleStockStatus.RESERVED],
    };
  }
}

export function buildPatchUpdateData(
  vehicleId: string,
  tenantId: string,
  vehicle: { stock_status: VehicleStockStatus | null },
  dto: PatchVehicleStockDto,
  isLocationChange = false,
  siteId?: string,
  destinationLocationId?: string,
): {
  where: Prisma.VehicleWhereInput;
  data: Prisma.VehicleUncheckedUpdateManyInput;
} {
  const data: Prisma.VehicleUncheckedUpdateManyInput = {
    site_id: isLocationChange ? siteId : undefined,
    location_id: destinationLocationId,
    mileage: dto.mileage,
    color: dto.color,
    key_number: dto.key_number,
    registration_certificate_no: dto.registration_certificate_no,
    ...(dto.first_registration_date !== undefined
      ? { first_registration_date: dto.first_registration_date }
      : {}),
    ...(dto.co2_wltp_g_km !== undefined
      ? { co2_wltp_g_km: dto.co2_wltp_g_km }
      : {}),
    ...(dto.co2_nedc_g_km !== undefined
      ? { co2_nedc_g_km: dto.co2_nedc_g_km }
      : {}),
    ...(dto.typenschein_no !== undefined
      ? { typenschein_no: dto.typenschein_no }
      : {}),
    ...(dto.nova_class !== undefined ? { nova_class: dto.nova_class } : {}),
    ...(dto.emission_class !== undefined
      ? { emission_class: dto.emission_class }
      : {}),
  };

  const where: Prisma.VehicleWhereInput = {
    id: vehicleId,
    tenant_id: tenantId,
    inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
  };

  applyReservationUpdate(
    where,
    data,
    vehicle.stock_status,
    dto.reserved_for_customer_id,
  );

  return { where, data };
}

@Injectable()
export class VehicleStockQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
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
    const siteId = await this.siteContext.getSiteId();
    const { page, limit } = parsePagination(params);
    const stockStatus = parseStockStatus(params.stock_status);
    const includeDrafts = shouldIncludeDrafts(stockStatus);
    const { vehicleOrderBy, draftOrderBy } = buildListOrderBy(
      params.sortField,
      params.sortDirection,
    );
    const { vehicleWhere, draftWhere } = buildVehicleListWhere(
      tenantId,
      siteId,
      stockStatus,
      params.search,
    );

    const [vehicleTotal, draftTotal] = await Promise.all([
      this.prisma.vehicle.count({ where: vehicleWhere }),
      this.countDrafts(includeDrafts, draftWhere),
    ]);
    const total = vehicleTotal + draftTotal;
    const window = concatPageWindow(draftTotal, page, limit);

    const [drafts, vehicles] = await Promise.all([
      this.fetchDrafts(includeDrafts, window.first, draftWhere, draftOrderBy),
      this.fetchStockVehicles(window.second, vehicleWhere, vehicleOrderBy),
    ]);

    return {
      data: [
        ...drafts.map(mapDraftVehiclePurchase),
        ...vehicles.map(mapStockVehicle),
      ],
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async listGewaehrleistungDue(query: GewaehrleistungDueListQueryDto) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const windowStart = new Date();
    windowStart.setUTCHours(0, 0, 0, 0);
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + query.endsWithinDays);
    windowEnd.setUTCHours(23, 59, 59, 999);

    const data = await this.prisma.vehicleSale.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        status: 'INVOICED',
        buyer_is_consumer: true,
        gewaehrleistung_ends_on: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        sale_number: true,
        vehicle_id: true,
        customer_id: true,
        handed_over_at: true,
        gewaehrleistung_ends_on: true,
        presumption_ends_on: true,
        gewaehrleistung_rule_version: true,
        vehicle: {
          select: {
            id: true,
            make: true,
            model: true,
            year: true,
            vin: true,
            plate: true,
          },
        },
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            company_name: true,
          },
        },
      },
      orderBy: [{ gewaehrleistung_ends_on: 'asc' }, { id: 'asc' }],
    });

    return {
      data,
      meta: {
        total: data.length,
        page: 1,
        pageSize: data.length,
        pageCount: data.length === 0 ? 0 : 1,
      },
    };
  }

  private async countDrafts(
    includeDrafts: boolean,
    siteScopedWhere: Prisma.VehiclePurchaseWhereInput,
  ): Promise<number> {
    if (!includeDrafts) return 0;
    return this.prisma.vehiclePurchase.count({ where: siteScopedWhere });
  }

  private async fetchDrafts(
    includeDrafts: boolean,
    window: { skip: number; take: number },
    siteScopedWhere: Prisma.VehiclePurchaseWhereInput,
    orderBy: Prisma.VehiclePurchaseOrderByWithRelationInput[],
  ) {
    if (!includeDrafts || window.take <= 0) return [];
    return this.prisma.vehiclePurchase.findMany({
      where: siteScopedWhere,
      orderBy,
      skip: window.skip,
      take: window.take,
    });
  }

  private async fetchStockVehicles(
    window: { skip: number; take: number },
    where: Prisma.VehicleWhereInput,
    orderBy: Prisma.VehicleOrderByWithRelationInput[],
  ) {
    if (window.take <= 0) return [];
    return this.prisma.vehicle.findMany({
      where,
      include: VEHICLE_LIST_INCLUDE,
      orderBy,
      skip: window.skip,
      take: window.take,
    });
  }

  async detail(vehicleId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        location: { site_id: siteId },
      },
      include: {
        reserved_for_customer: {
          select: RESERVED_CUSTOMER_SELECT,
        },
        location: true,
        purchases: { orderBy: { createdAt: 'desc' } },
        sales: { orderBy: { createdAt: 'desc' } },
        ledger_entries: { orderBy: { createdAt: 'asc' } },
        workshop_orders: {
          where: { site_id: siteId, purpose: 'STOCK_PREP' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    return {
      ...stripVehicleIdentityResolutionState(vehicle),
      cost_basis: costBasis(vehicle.ledger_entries),
    };
  }

  async patch(vehicleId: string, dto: PatchVehicleStockDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        location: { site_id: siteId },
        inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
      },
      include: { location: true },
    });

    validatePatchTransitions(vehicle, vehicleId);
    validateLotInput(dto);

    const normalizedDto = normalizeVehicleRegulatoryFields(dto);
    assertVehicleRegulatoryFields(normalizedDto);

    const isLocationChange =
      dto.location_id !== undefined && dto.location_id !== vehicle.location_id;
    const destinationLocationId = isLocationChange
      ? await this.resolveDestinationLot(tenantId, siteId, vehicle, dto)
      : undefined;

    if (dto.reserved_for_customer_id) {
      await assertTenantCustomerExists(
        this.prisma,
        tenantId,
        dto.reserved_for_customer_id,
      );
    }

    const { where, data } = buildPatchUpdateData(
      vehicleId,
      tenantId,
      vehicle,
      normalizedDto,
      isLocationChange,
      siteId,
      destinationLocationId,
    );

    const updated = isLocationChange
      ? await this.prisma.$transaction(async (tx) => {
          await lockSitesAndAssertActive(tx, tenantId, [siteId]);
          return tx.vehicle.updateMany({
            where: {
              ...where,
              location_id: dto.expectedLocationId,
              stock_status: {
                in: [
                  VehicleStockStatus.IN_STOCK,
                  VehicleStockStatus.RESERVED,
                  VehicleStockStatus.IN_PREP,
                ],
              },
            },
            data: {
              ...data,
              location_id: destinationLocationId,
              site_id: siteId,
            },
          });
        })
      : await this.prisma.vehicle.updateMany({ where, data });

    if (updated.count === 0) {
      throw new ConflictException(
        'Vehicle status changed concurrently and cannot be patched',
      );
    }

    return this.detail(vehicleId);
  }

  private async resolveDestinationLot(
    tenantId: string,
    siteId: string,
    vehicle: {
      stock_status: VehicleStockStatus | null;
      location: { site_id: string } | null;
      location_id: string | null;
    },
    dto: PatchVehicleStockDto,
  ): Promise<string> {
    if (vehicle.stock_status === VehicleStockStatus.SOLD) {
      throw new ConflictException('SOLD vehicles cannot be moved');
    }
    if (!vehicle.location || vehicle.location.site_id !== siteId) {
      throw new UnprocessableEntityException(
        'Vehicle lot does not belong to the active site',
      );
    }
    if (!dto.expectedLocationId) {
      throw new UnprocessableEntityException(
        'expectedLocationId is required when changing a vehicle lot',
      );
    }
    if (dto.expectedLocationId !== vehicle.location_id) {
      throw new ConflictException(
        'Vehicle location changed concurrently. Please refresh.',
      );
    }
    const destination = await this.prisma.storageLocation.findFirst({
      where: {
        id: dto.location_id ?? undefined,
        tenant_id: tenantId,
        site_id: siteId,
        type: 'vehicle_lot',
        is_system: false,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!destination) {
      throw new UnprocessableEntityException(
        'Destination must be an active vehicle lot on the active site',
      );
    }
    return destination.id;
  }
}
