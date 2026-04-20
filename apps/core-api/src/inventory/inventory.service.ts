import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Checks the availability of a part by SKU.
   * If the part is superseded, it recursively checks the stock for the superseding part.
   * @param sku The Manufacturer Part Number (MPN).
   */
  async checkAvailability(sku: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const item = await this.prisma.catalogItem.findUnique({
      where: { tenant_id_sku: { tenant_id: tenantId, sku } },
      include: {
        stocks: {
          include: {
            location: true,
          },
        },
        brand: true,
        superseded_by: {
          select: { id: true, sku: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Catalog item with SKU ${sku} not found`);
    }

    // If there is a superseding part, recursively check its availability
    if (item.superseded_by) {
      const suggestion: any = await this.checkAvailability(
        item.superseded_by.sku,
      );
      return {
        ...suggestion,
        original_sku: sku,
        suggested_sku: item.superseded_by.sku,
        is_superseded: true,
      };
    }

    // Base case: No more supersessions, return current stock summed across all locations
    const onHand = item.stocks.reduce((sum, s) => sum + s.quantity_on_hand, 0);
    const reserved = item.stocks.reduce(
      (sum, s) => sum + s.quantity_reserved,
      0,
    );
    const available = onHand - reserved;

    return {
      sku: item.sku,
      name: item.name,
      brand: item.brand?.name || '',
      quantity_on_hand: onHand,
      quantity_reserved: reserved,
      quantity_available: available,
      is_superseded: false,
    };
  }

  /**
   * Finds items in the inventory with pagination, search, and filtering.
   * @param options Pagination, search, and filter options.
   */
  async findAll(params: any) {
    const tenantId = await this.tenantContext.getTenantId();
    let items, total;

    // Check if using QueryBuilder params (has where/skip/take)
    if (
      params &&
      (params.where || params.orderBy || params.skip !== undefined)
    ) {
      [items, total] = await Promise.all([
        this.prisma.catalogItem.findMany({
          ...params,
          where: { ...(params.where ?? {}), tenant_id: tenantId },
          include: {
            brand: true,
            stocks: {
              include: {
                location: true,
              },
            },
            superseded_by: {
              select: { id: true, sku: true },
            },
          },
        }),
        this.prisma.catalogItem.count({
          where: { ...(params.where ?? {}), tenant_id: tenantId },
        }),
      ]);
    } else {
      // Legacy path
      const {
        page = 1,
        pageSize,
        limit = 10,
        search,
        location,
        brand,
        brandId,
      } = params;
      const effectivePageSize = pageSize ?? limit;
      const skip = (page - 1) * effectivePageSize;
      const where: any = { tenant_id: tenantId };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { brand: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      if (brand) where.brand = { name: { equals: brand, mode: 'insensitive' } };
      if (brandId) where.brand_id = brandId;
      if (location) {
        where.stocks = {
          some: {
            location: {
              name: { contains: location, mode: 'insensitive' },
            },
          },
        };
      }

      [items, total] = await Promise.all([
        this.prisma.catalogItem.findMany({
          where,
          include: {
            brand: true,
            stocks: {
              include: {
                location: true,
              },
            },
            superseded_by: {
              select: { id: true, sku: true },
            },
          },
          skip,
          take: effectivePageSize,
        }),
        this.prisma.catalogItem.count({ where }),
      ]);
    }

    // Pagination precedence: take > pageSize > limit > default(10)
    const resolvedPageSize =
      params.take || params.pageSize || params.limit || 10;
    const pageCount = Math.ceil(total / resolvedPageSize);

    // Transform items to match frontend expected shape
    const transformedItems = items.map((item) => {
      const onHand = item.stocks.reduce(
        (sum, s) => sum + s.quantity_on_hand,
        0,
      );
      const reserved = item.stocks.reduce(
        (sum, s) => sum + s.quantity_reserved,
        0,
      );
      const available = onHand - reserved;

      let status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'SUPERSEDED';
      if (item.superseded_by) {
        status = 'SUPERSEDED';
      } else if (available > 0) {
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
        warehouse_location: item.stocks[0]?.location?.name || 'N/A',
      };
    });

    return {
      data: transformedItems,
      meta: {
        total,
        page:
          params.page || params.skip / (params.take || resolvedPageSize) + 1, // Estimate page for legacy or QB
        pageSize: resolvedPageSize,
        pageCount,
      },
    };
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
