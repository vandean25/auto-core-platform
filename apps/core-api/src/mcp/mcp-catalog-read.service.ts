import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MCP_DEFAULT_PAGE_SIZE } from './mcp.constants.js';
import {
  MCP_PRICE_HISTORY_LIMIT,
  mcpCatalogItemPositionSchema,
  mcpMarginRulePositionSchema,
  toMcpCatalogItemDetail,
  toMcpLaborListRow,
  toMcpListPage,
  toMcpMarginRuleRow,
  toMcpPartListRow,
  toMcpPriceListRow,
  vendorIdOfPriceList,
  type McpCatalogItemPosition,
  type McpMarginRulePosition,
} from './mcp-catalog-read.mapper.js';
import {
  decodeMcpKeysetCursor,
  decodeMcpPositionCursor,
  encodeMcpKeysetCursor,
  encodeMcpPositionCursor,
  type McpKeysetCursor,
} from './mcp-output.util.js';
import type {
  getCatalogItemInputSchema,
  listCatalogItemsInputSchema,
  listMarginRulesInputSchema,
  listPriceListsInputSchema,
} from './mcp-tool-schemas.js';

type ListCatalogItemsInput = z.infer<typeof listCatalogItemsInputSchema>;
type GetCatalogItemInput = z.infer<typeof getCatalogItemInputSchema>;
type ListPriceListsInput = z.infer<typeof listPriceListsInputSchema>;
type ListMarginRulesInput = z.infer<typeof listMarginRulesInputSchema>;

const PART_LIST_SELECT = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  retail_price: true,
} as const;

const LABOR_LIST_SELECT = {
  id: true,
  code: true,
  description: true,
  hourly_rate: true,
} as const;

const CATALOG_ITEM_DETAIL_SELECT = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  ean: true,
  cost_price: true,
  retail_price: true,
  oem_numbers: true,
  superseded_by_id: true,
  brand_id: true,
  revenue_group_id: true,
} as const;

const PRICE_HISTORY_SELECT = {
  createdAt: true,
  old_cost: true,
  new_cost: true,
  old_retail: true,
  new_retail: true,
  import_job_id: true,
} as const;

const PRICE_LIST_SELECT = {
  id: true,
  file_name: true,
  appliedAt: true,
  totals_json: true,
  options_json: true,
} as const;

const MARGIN_RULE_SELECT = {
  id: true,
  name: true,
  priority: true,
  is_active: true,
  brand_id: true,
  revenue_group_id: true,
  cost_min: true,
  cost_max: true,
  markup_percent: true,
  use_supplier_rrp: true,
  rounding: true,
} as const;

function containsInsensitive(value: string) {
  return { contains: value, mode: 'insensitive' as const };
}

function parsePositionOrThrow<T>(cursor: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(decodeMcpPositionCursor(cursor));
  if (!parsed.success) {
    throw new BadRequestException('cursor is invalid');
  }
  return parsed.data;
}

function parseKeysetOrThrow(cursor: string): McpKeysetCursor {
  const decoded = decodeMcpKeysetCursor(cursor);
  if (!decoded) {
    throw new BadRequestException('cursor is invalid');
  }
  return decoded;
}

function uniqueIds<T extends string | number>(values: (T | null)[]): T[] {
  return [...new Set(values.filter((value): value is T => value !== null))];
}

/**
 * Read-only catalog and price tools (AUT-460). The catalog, labor, vendor,
 * margin, and price list tables are tenant-wide, so every query takes its
 * tenant from the session. The active site only scopes the stock behind a
 * catalog item's default bin. Nothing here writes, and no import runs.
 */
@Injectable()
export class McpCatalogReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly siteContext: SiteContextService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Parts by default. `type: labor` lists the labor operations in the same row shape. */
  async listCatalogItems(input: ListCatalogItemsInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const type = input.type ?? 'part';
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;
    const position = input.cursor
      ? parsePositionOrThrow(input.cursor, mcpCatalogItemPositionSchema)
      : null;
    if (position && position.type !== type) {
      throw new BadRequestException('cursor is invalid');
    }

    return type === 'labor'
      ? this.listLaborOperations(tenantId, input, pageSize, position)
      : this.listParts(tenantId, input, pageSize, position);
  }

  private async listParts(
    tenantId: string,
    input: ListCatalogItemsInput,
    pageSize: number,
    position: McpCatalogItemPosition | null,
  ) {
    const where: Prisma.CatalogItemWhereInput = {
      tenant_id: tenantId,
      ...(input.query
        ? {
            OR: [
              { sku: containsInsensitive(input.query) },
              { name: containsInsensitive(input.query) },
              { ean: containsInsensitive(input.query) },
            ],
          }
        : {}),
      ...(input.active === true ? { superseded_by_id: null } : {}),
      ...(input.active === false ? { superseded_by_id: { not: null } } : {}),
      ...(position
        ? {
            AND: [
              {
                OR: [
                  { sku: { gt: position.key } },
                  { sku: position.key, id: { gt: position.id } },
                ],
              },
            ],
          }
        : {}),
    };

    const records = await this.prisma.catalogItem.findMany({
      where,
      orderBy: [{ sku: 'asc' }, { id: 'asc' }],
      take: pageSize + 1,
      select: PART_LIST_SELECT,
    });
    return toMcpListPage(records, pageSize, {
      cursorOf: (record) =>
        encodeMcpPositionCursor({
          type: 'part',
          key: record.sku,
          id: record.id,
        }),
      mapRow: toMcpPartListRow,
    });
  }

  private async listLaborOperations(
    tenantId: string,
    input: ListCatalogItemsInput,
    pageSize: number,
    position: McpCatalogItemPosition | null,
  ) {
    const where: Prisma.LaborOperationWhereInput = {
      tenant_id: tenantId,
      ...(input.query
        ? {
            OR: [
              { code: containsInsensitive(input.query) },
              { description: containsInsensitive(input.query) },
            ],
          }
        : {}),
      ...(input.active === undefined ? {} : { is_active: input.active }),
      ...(position
        ? {
            AND: [
              {
                OR: [
                  { code: { gt: position.key } },
                  { code: position.key, id: { gt: position.id } },
                ],
              },
            ],
          }
        : {}),
    };

    const records = await this.prisma.laborOperation.findMany({
      where,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: pageSize + 1,
      select: LABOR_LIST_SELECT,
    });
    return toMcpListPage(records, pageSize, {
      cursorOf: (record) =>
        encodeMcpPositionCursor({
          type: 'labor',
          key: record.code,
          id: record.id,
        }),
      mapRow: toMcpLaborListRow,
    });
  }

  /**
   * One catalog item with its tax class, brand, default bin and vendor, and the
   * five newest price history rows. The item is looked up in the tenant first,
   * then each related row is read in the same tenant.
   */
  async getCatalogItem(input: GetCatalogItemInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.findSiteId();
    const item = await this.prisma.catalogItem.findFirst({
      where: { id: input.id, tenant_id: tenantId },
      select: CATALOG_ITEM_DETAIL_SELECT,
    });
    if (!item) {
      throw new NotFoundException(`Catalog item with ID ${input.id} not found`);
    }

    const [
      brand,
      revenueGroup,
      supersededBy,
      defaultBin,
      defaultVendor,
      priceHistory,
    ] = await Promise.all([
      item.brand_id === null
        ? null
        : this.prisma.brand.findFirst({
            where: { id: item.brand_id, tenant_id: tenantId },
            select: { id: true, name: true },
          }),
      item.revenue_group_id === null
        ? null
        : this.prisma.revenueGroup.findFirst({
            where: { id: item.revenue_group_id, tenant_id: tenantId },
            select: { id: true, name: true, tax_rate: true },
          }),
      item.superseded_by_id === null
        ? null
        : this.prisma.catalogItem.findFirst({
            where: { id: item.superseded_by_id, tenant_id: tenantId },
            select: { id: true, sku: true, name: true },
          }),
      siteId ? this.defaultBin(tenantId, siteId, item.id) : null,
      this.defaultVendor(tenantId, item.id),
      this.prisma.catalogPriceHistory.findMany({
        where: { tenant_id: tenantId, catalog_item_id: item.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MCP_PRICE_HISTORY_LIMIT,
        select: PRICE_HISTORY_SELECT,
      }),
    ]);

    return toMcpCatalogItemDetail(item, {
      brand,
      revenueGroup,
      supersededBy,
      defaultBin,
      defaultVendor,
      priceHistory,
    });
  }

  /**
   * The bin at the active site that holds the most stock of the item. The schema
   * has no default bin flag, so the bin with the most stock stands in for it.
   * Warehouse locations and deleted bins are never chosen.
   */
  private defaultBin(tenantId: string, siteId: string, catalogItemId: string) {
    return this.prisma.inventoryStock.findFirst({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        catalog_item_id: catalogItemId,
        quantity_on_hand: { gt: 0 },
        location: { type: 'bin', deletedAt: null },
      },
      orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
      select: {
        quantity_on_hand: true,
        location: { select: { id: true, code: true, name: true } },
      },
    });
  }

  /**
   * The supplier article link updated most recently, with its vendor. The
   * schema has no default vendor flag, so the latest updated link stands in.
   */
  private async defaultVendor(tenantId: string, catalogItemId: string) {
    const article = await this.prisma.vendorArticle.findFirst({
      where: { tenant_id: tenantId, catalog_item_id: catalogItemId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: {
        vendor_id: true,
        vendor_article_no: true,
        last_cost: true,
        last_rrp: true,
      },
    });
    if (!article) {
      return null;
    }
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: article.vendor_id, tenant_id: tenantId },
      select: { id: true, name: true },
    });
    if (!vendor) {
      return null;
    }
    return {
      vendor,
      vendor_article_no: article.vendor_article_no,
      last_cost: article.last_cost,
      last_rrp: article.last_rrp,
    };
  }

  /** Applied supplier price lists (SUPPLIER_PRICE_LIST import jobs), newest applied first. */
  async listPriceLists(input: ListPriceListsInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;
    const after = input.cursor ? parseKeysetOrThrow(input.cursor) : null;
    const appliedBefore = after
      ? {
          AND: [
            {
              OR: [
                { appliedAt: { lt: new Date(after.at) } },
                { appliedAt: new Date(after.at), id: { lt: after.id } },
              ],
            },
          ],
        }
      : {};

    const records = await this.prisma.importJob.findMany({
      where: {
        tenant_id: tenantId,
        entity_type: 'SUPPLIER_PRICE_LIST',
        status: 'APPLIED',
        appliedAt: { not: null },
        ...appliedBefore,
      },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      select: PRICE_LIST_SELECT,
    });

    const vendors = await this.vendorsById(
      tenantId,
      records
        .slice(0, pageSize)
        .map((record) => vendorIdOfPriceList(record.options_json)),
    );
    return toMcpListPage(records, pageSize, {
      cursorOf: (record) =>
        encodeMcpKeysetCursor({
          at: record.appliedAt!.toISOString(),
          id: record.id,
        }),
      mapRow: (record) => {
        const vendorId = vendorIdOfPriceList(record.options_json);
        return toMcpPriceListRow(
          record,
          vendorId ? (vendors.get(vendorId) ?? null) : null,
        );
      },
    });
  }

  /** Margin rules in evaluation order: priority ascending, then ID. Inactive rules are listed with active false. */
  async listMarginRules(input: ListMarginRulesInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;
    const position = input.cursor
      ? parsePositionOrThrow(input.cursor, mcpMarginRulePositionSchema)
      : null;

    const records = await this.prisma.marginRule.findMany({
      where: {
        tenant_id: tenantId,
        ...(position ? { AND: [marginRuleAfter(position)] } : {}),
      },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      take: pageSize + 1,
      select: MARGIN_RULE_SELECT,
    });

    const page = records.slice(0, pageSize);
    const brandIds = uniqueIds(page.map((record) => record.brand_id));
    const revenueGroupIds = uniqueIds(
      page.map((record) => record.revenue_group_id),
    );
    const [brands, revenueGroups] = await Promise.all([
      this.brandsById(tenantId, brandIds),
      this.revenueGroupsById(tenantId, revenueGroupIds),
    ]);
    const brandById = new Map(brands.map((brand) => [brand.id, brand]));
    const revenueGroupById = new Map(
      revenueGroups.map((group) => [group.id, group]),
    );

    return toMcpListPage(records, pageSize, {
      cursorOf: (record) =>
        encodeMcpPositionCursor({ priority: record.priority, id: record.id }),
      mapRow: (record) =>
        toMcpMarginRuleRow(record, {
          brand:
            record.brand_id === null
              ? null
              : (brandById.get(record.brand_id) ?? null),
          revenueGroup:
            record.revenue_group_id === null
              ? null
              : (revenueGroupById.get(record.revenue_group_id) ?? null),
        }),
    });
  }

  private async brandsById(
    tenantId: string,
    ids: number[],
  ): Promise<{ id: number; name: string }[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.brand.findMany({
      where: { tenant_id: tenantId, id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  private async revenueGroupsById(
    tenantId: string,
    ids: number[],
  ): Promise<{ id: number; name: string }[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.revenueGroup.findMany({
      where: { tenant_id: tenantId, id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  private async vendorsById(
    tenantId: string,
    vendorIds: (string | null)[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const ids = uniqueIds(vendorIds);
    if (ids.length === 0) {
      return new Map();
    }
    const vendors = await this.prisma.vendor.findMany({
      where: { tenant_id: tenantId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(vendors.map((vendor) => [vendor.id, vendor]));
  }
}

/** Rules strictly after a position in (priority, id) order. */
function marginRuleAfter(
  position: McpMarginRulePosition,
): Prisma.MarginRuleWhereInput {
  return {
    OR: [
      { priority: { gt: position.priority } },
      { priority: position.priority, id: { gt: position.id } },
    ],
  };
}
