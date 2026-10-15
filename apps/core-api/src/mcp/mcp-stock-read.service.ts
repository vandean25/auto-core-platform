import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { CatalogService } from '../catalog/catalog.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { VehicleStockReportsService } from '../vehicle-stock/vehicle-stock-reports.service.js';
import { clampMcpPage, clampMcpPageSize } from './mcp-output.util.js';
import {
  offsetFromCursor,
  toMcpStockAgeReport,
  toMcpStockMarginReport,
} from './mcp-report-read.mapper.js';
import {
  binFieldsFromLevels,
  mapInventoryStocksToBinLevels,
  mcpStockBinStockSelect,
  mcpStockBinWhere,
} from './mcp-stock-read.mapper.js';
import type {
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
} from './mcp-tool-schemas.js';

type StockAgeReportInput = z.infer<typeof getVehicleStockAgeReportInputSchema>;
type StockMarginReportInput = z.infer<
  typeof getVehicleStockMarginReportInputSchema
>;

/** MCP reads of parts, stock levels and dealer vehicle reports. Tenant and site scope come from the delegated services. */
@Injectable()
export class McpStockReadService {
  private readonly catalogService: CatalogService;
  private readonly inventoryService: InventoryService;
  private readonly prisma: PrismaService;
  private readonly siteContext: SiteContextService;
  private readonly tenantContext: TenantContextService;
  private readonly vehicleStockReports: VehicleStockReportsService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    catalogService: CatalogService,
    inventoryService: InventoryService,
    prisma: PrismaService,
    siteContext: SiteContextService,
    tenantContext: TenantContextService,
    vehicleStockReports: VehicleStockReportsService,
  ) {
    this.catalogService = catalogService;
    this.inventoryService = inventoryService;
    this.prisma = prisma;
    this.siteContext = siteContext;
    this.tenantContext = tenantContext;
    this.vehicleStockReports = vehicleStockReports;
  }

  async searchParts(input: {
    query: string;
    workshop_order_id?: string;
    page?: number;
    page_size?: number;
  }) {
    if (input.workshop_order_id) {
      const catalogResult = await this.catalogService.search(
        input.query,
        input.workshop_order_id,
      );
      return await this.enrichCatalogSearchResult(catalogResult);
    }

    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.page_size);
    const inventoryResult = await this.inventoryService.findAll({
      search: input.query,
      page,
      pageSize,
    });
    return await this.enrichInventorySearchResult(inventoryResult);
  }

  async getStockLevel(input: { catalog_item_id?: string; sku?: string }) {
    const tenantId = await this.tenantContext.getTenantId();

    if (input.sku) {
      const availability = await this.inventoryService.checkAvailability(
        input.sku,
      );
      const stockContext = await this.loadStockLevelContext(
        tenantId,
        availability.sku,
      );
      return {
        ...availability,
        ...stockContext,
      };
    }

    const item = await this.prisma.catalogItem.findFirst({
      where: { id: input.catalog_item_id, tenant_id: tenantId },
      select: { id: true, sku: true },
    });
    if (!item) {
      throw new NotFoundException(
        `Catalog item with ID ${input.catalog_item_id} not found`,
      );
    }

    const availability = await this.inventoryService.checkAvailability(
      item.sku,
    );
    const stockContext = await this.loadStockLevelContext(tenantId, item.sku);
    return {
      ...availability,
      ...stockContext,
    };
  }

  private async enrichInventorySearchResult<
    T extends {
      data: Array<{ id: string }>;
      meta: unknown;
    },
  >(result: T) {
    const catalogItemIds = result.data.map((row) => row.id);
    const binsByItem = await this.loadPrimaryBinsByCatalogItem(catalogItemIds);
    return {
      ...result,
      data: result.data.map((row) => {
        const bins = binsByItem.get(row.id) ?? [];
        return {
          ...row,
          catalog_item_id: row.id,
          ...binFieldsFromLevels(bins),
        };
      }),
    };
  }

  private async enrichCatalogSearchResult<
    T extends {
      parts: Array<{ id: string }>;
      labor: unknown;
      meta: unknown;
    },
  >(result: T) {
    const catalogItemIds = result.parts.map((part) => part.id);
    const binsByItem = await this.loadPrimaryBinsByCatalogItem(catalogItemIds);
    const catalogIds = new Set(
      (
        await this.prisma.catalogItem.findMany({
          where: {
            tenant_id: await this.tenantContext.getTenantId(),
            id: { in: catalogItemIds },
          },
          select: { id: true },
        })
      ).map((row) => row.id),
    );

    return {
      ...result,
      parts: result.parts.map((part) => {
        const isCatalogItem = catalogIds.has(part.id);
        const bins = isCatalogItem ? binsByItem.get(part.id) ?? [] : [];
        return {
          ...part,
          catalog_item_id: isCatalogItem ? part.id : null,
          ...binFieldsFromLevels(bins),
        };
      }),
    };
  }

  private async loadPrimaryBinsByCatalogItem(catalogItemIds: string[]) {
    if (catalogItemIds.length === 0) {
      return new Map();
    }
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const stocks = await this.prisma.inventoryStock.findMany({
      where: mcpStockBinWhere(tenantId, siteId, catalogItemIds),
      select: mcpStockBinStockSelect,
      orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
    });
    return mapInventoryStocksToBinLevels(stocks);
  }

  private async loadStockLevelContext(tenantId: string, sku: string) {
    const item = await this.prisma.catalogItem.findFirst({
      where: { tenant_id: tenantId, sku },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException(`Catalog item with SKU ${sku} not found`);
    }
    const siteId = await this.siteContext.getSiteId();
    const stocks = await this.prisma.inventoryStock.findMany({
      where: mcpStockBinWhere(tenantId, siteId, [item.id]),
      select: mcpStockBinStockSelect,
      orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
    });
    const bins = mapInventoryStocksToBinLevels(stocks).get(item.id) ?? [];
    return {
      catalog_item_id: item.id,
      bins,
      ...binFieldsFromLevels(bins),
    };
  }

  /** AUT-461: the stock-in window, site, and offset page of the dealer stock age report. */
  async vehicleStockAgeReport(input: StockAgeReportInput) {
    const siteId = input.site_id ?? (await this.siteContext.getSiteId());
    const scope = {
      siteId,
      from: input.from,
      to: input.to,
      offset: offsetFromCursor(input.cursor),
      pageSize: clampMcpPageSize(input.pageSize),
    };
    const report = await this.vehicleStockReports.stockAge({
      inventory_role: input.inventory_role,
      stock_status: input.stock_status,
      bucket: input.bucket,
      siteId,
      stockReceivedFrom: input.from,
      stockReceivedTo: input.to,
      offset: scope.offset,
      limit: scope.pageSize,
    });
    return toMcpStockAgeReport(report, scope);
  }

  /** AUT-461: the period, site, and offset page of the invoiced vehicle margin report. */
  async vehicleStockMarginReport(input: StockMarginReportInput) {
    const siteId = input.site_id ?? (await this.siteContext.getSiteId());
    const scope = {
      siteId,
      from: input.from,
      to: input.to,
      offset: offsetFromCursor(input.cursor),
      pageSize: clampMcpPageSize(input.pageSize),
    };
    const report = await this.vehicleStockReports.margin({
      from: input.from,
      to: input.to,
      siteId,
      offset: scope.offset,
      limit: scope.pageSize,
    });
    return toMcpStockMarginReport(report, scope);
  }
}
