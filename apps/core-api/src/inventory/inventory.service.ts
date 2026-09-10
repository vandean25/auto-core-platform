import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { LocationType, Prisma } from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { AtpService, type AtpStockInput } from './atp.service';

function buildCatalogItemInclude(tenantId: string, siteId: string) {
  return {
    brand: true,
    stocks: {
      where: {
        tenant_id: tenantId,
        location: {
          tenant_id: tenantId,
          site_id: siteId,
          type: { not: LocationType.staging_tote },
        },
      },
      include: {
        location: true,
      },
    },
    superseded_by: {
      select: { id: true, sku: true },
    },
  } satisfies Prisma.CatalogItemInclude;
}

export interface AvailabilityCheckResult {
  sku: string;
  name: string;
  brand: string;
  original_sku?: string;
  suggested_sku?: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  is_superseded: boolean;
}

export interface InventoryQueryParams {
  where?: Prisma.CatalogItemWhereInput;
  orderBy?: Prisma.CatalogItemOrderByWithRelationInput[];
  skip?: number;
  take?: number;
  page?: number | string;
  pageSize?: number | string;
  limit?: number | string;
  search?: string;
  location?: string;
  brand?: string;
  brandId?: number;
}

type CatalogItemWithStocksAndBrand = Prisma.CatalogItemGetPayload<{
  include: {
    brand: true;
    stocks: { include: { location: true } };
    superseded_by: { select: { id: true; sku: true } };
  };
}>;

interface InventoryContext {
  tenantId: string;
  siteId: string;
}

function buildLegacyInventoryWhere(
  tenantId: string,
  siteId: string,
  params: InventoryQueryParams,
): Prisma.CatalogItemWhereInput {
  const where: Prisma.CatalogItemWhereInput = { tenant_id: tenantId };
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { sku: { contains: params.search, mode: 'insensitive' } },
      { brand: { name: { contains: params.search, mode: 'insensitive' } } },
    ];
  }
  if (params.brand) {
    where.brand = { name: { equals: params.brand, mode: 'insensitive' } };
  }
  if (params.brandId) {
    where.brand_id = params.brandId;
  }
  if (params.location) {
    where.stocks = {
      some: {
        tenant_id: tenantId,
        location: {
          tenant_id: tenantId,
          site_id: siteId,
          type: { not: LocationType.staging_tote },
          name: { contains: params.location, mode: 'insensitive' },
        },
      },
    };
  }
  return where;
}

function resolveInventoryPagination(params: InventoryQueryParams): {
  skip: number;
  pageSize: number;
} {
  const page = params.page ? Number(params.page) : 1;
  const pageSize = params.pageSize ? Number(params.pageSize) : undefined;
  const limit = params.limit ? Number(params.limit) : 10;
  const effectivePageSize = pageSize ?? limit;
  const skip = (page - 1) * effectivePageSize;
  return { skip, pageSize: effectivePageSize };
}

function toAtpStockInput(
  stock: CatalogItemWithStocksAndBrand['stocks'][number],
): AtpStockInput {
  return {
    id: stock.id,
    locationId: stock.location_id,
    quantity_on_hand: stock.quantity_on_hand,
    quantity_reserved: stock.quantity_reserved,
  };
}

function filterAtpStocks(
  stocks: CatalogItemWithStocksAndBrand['stocks'],
  siteId: string,
) {
  return stocks.filter(
    (stock) =>
      stock.location.site_id === siteId &&
      stock.location.type !== LocationType.staging_tote,
  );
}

function transformInventoryItem(
  item: CatalogItemWithStocksAndBrand,
  atpService: AtpService,
  siteId: string,
) {
  const eligibleStocks = filterAtpStocks(item.stocks, siteId);
  const totals = atpService.sumAtp(eligibleStocks.map(toAtpStockInput), {
    operation: 'inventory_list',
    tenantId: item.tenant_id,
  });
  const available = totals.quantityAvailable.toNumber();

  let status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'SUPERSEDED';
  if (item.superseded_by) {
    status = 'SUPERSEDED';
  } else if (totals.quantityAvailable.gt(0)) {
    status = 'IN_STOCK';
  } else {
    status = 'OUT_OF_STOCK';
  }

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    brand: item.brand?.name || '',
    brand_id: item.brand_id,
    price: Number(item.retail_price),
    status,
    quantity_available: available,
    warehouse_location: eligibleStocks[0]?.location?.name || 'N/A',
  };
}

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly atpService: AtpService,
  ) {}

  /**
   * Checks the availability of a part by SKU.
   * If the part is superseded, it recursively checks the stock for the superseding part.
   * @param sku The Manufacturer Part Number (MPN).
   */
  async checkAvailability(sku: string): Promise<AvailabilityCheckResult> {
    const context = await this.getInventoryContext();
    return await this.checkAvailabilityForSku(sku, context);
  }

  private async checkAvailabilityForSku(
    sku: string,
    context: InventoryContext,
  ): Promise<AvailabilityCheckResult> {
    const item = await this.prisma.catalogItem.findFirst({
      where: { tenant_id: context.tenantId, sku },
      include: buildCatalogItemInclude(context.tenantId, context.siteId),
    });

    if (!item) {
      throw new NotFoundException(`Catalog item with SKU ${sku} not found`);
    }

    // If there is a superseding part, recursively check its availability
    if (item.superseded_by) {
      const suggestion = await this.checkAvailabilityForSku(
        item.superseded_by.sku,
        context,
      );
      return {
        ...suggestion,
        original_sku: sku,
        suggested_sku: item.superseded_by.sku,
        is_superseded: true,
      };
    }

    const totals = this.atpService.sumAtp(
      filterAtpStocks(item.stocks, context.siteId).map(toAtpStockInput),
      {
        operation: 'inventory_availability',
        tenantId: context.tenantId,
        siteId: context.siteId,
      },
    );

    return {
      sku: item.sku,
      name: item.name,
      brand: item.brand?.name || '',
      quantity_on_hand: totals.quantityOnHand.toNumber(),
      quantity_reserved: totals.quantityReserved.toNumber(),
      quantity_available: totals.quantityAvailable.toNumber(),
      is_superseded: false,
    };
  }

  /**
   * Finds items in the inventory with pagination, search, and filtering.
   * @param params Pagination, search, and filter options.
   */
  async findAll(params: InventoryQueryParams) {
    const context = await this.getInventoryContext();
    const [items, total] = await this.fetchInventoryWithParams(
      context.tenantId,
      context.siteId,
      params,
    );

    const resolvedPageSize = Number(
      params.take || params.pageSize || params.limit || 10,
    );
    const pageCount = Math.ceil(total / resolvedPageSize);
    const transformedItems = items.map((item) =>
      transformInventoryItem(item, this.atpService, context.siteId),
    );

    return {
      data: transformedItems,
      meta: {
        total,
        page:
          Number(params.page) ||
          Number(params.skip ?? 0) / (Number(params.take) || resolvedPageSize) +
            1,
        pageSize: resolvedPageSize,
        pageCount,
      },
    };
  }

  private async fetchInventoryWithParams(
    tenantId: string,
    siteId: string,
    params: InventoryQueryParams,
  ): Promise<[CatalogItemWithStocksAndBrand[], number]> {
    const isQueryBuilder =
      Boolean(params) &&
      Boolean(params.where || params.orderBy || params.skip !== undefined);

    if (isQueryBuilder) {
      return Promise.all([
        this.prisma.catalogItem.findMany({
          where: {
            ...(params.where ?? {}),
            tenant_id: tenantId,
          },
          orderBy: params.orderBy,
          skip: params.skip,
          take: params.take,
          include: buildCatalogItemInclude(tenantId, siteId),
        }),
        this.prisma.catalogItem.count({
          where: {
            ...(params.where ?? {}),
            tenant_id: tenantId,
          },
        }),
      ]);
    }

    const { skip, pageSize } = resolveInventoryPagination(params);
    const where = buildLegacyInventoryWhere(tenantId, siteId, params);

    return Promise.all([
      this.prisma.catalogItem.findMany({
        where,
        include: buildCatalogItemInclude(tenantId, siteId),
        skip,
        take: pageSize,
      }),
      this.prisma.catalogItem.count({ where }),
    ]);
  }

  private async getInventoryContext(): Promise<InventoryContext> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return { tenantId, siteId };
  }

  async createItem(data: {
    sku: string;
    name: string;
    cost_price: number;
    retail_price: number;
    unit?: string;
    brandId?: number;
    revenue_group_id?: number;
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    if (data.brandId) {
      const brand = await this.prisma.brand.findFirst({
        where: { id: data.brandId, tenant_id: tenantId },
      });
      if (!brand) {
        throw new BadRequestException(
          `Brand with ID ${data.brandId} does not exist`,
        );
      }
    }

    if (data.revenue_group_id) {
      const revenueGroup = await this.prisma.revenueGroup.findFirst({
        where: { id: data.revenue_group_id, tenant_id: tenantId },
      });
      if (!revenueGroup) {
        throw new BadRequestException(
          `Revenue group with ID ${data.revenue_group_id} not found or belongs to another tenant`,
        );
      }
    }

    const catalogItem = await this.prisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: data.sku,
        name: data.name,
        cost_price: data.cost_price,
        retail_price: data.retail_price,
        unit: data.unit || 'pcs',
        brand_id: data.brandId,
        revenue_group_id: data.revenue_group_id,
      },
    });

    return catalogItem;
  }
}
