import { BadRequestException, Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  VehicleInventoryRole,
  VehicleSaleStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type {
  VehicleStockAgeReportQueryDto,
  VehicleStockMarginReportQueryDto,
} from './dto/vehicle-stock-reports.dto.js';
import {
  calculateGrossMargin,
  calculateMarginPercent,
  daysInStock,
  stockAgeBucket,
} from './vehicle-stock-reports.math.js';

const DEALER_ROLES = [
  VehicleInventoryRole.USED,
  VehicleInventoryRole.NEW,
  VehicleInventoryRole.DEMO,
] as const;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function pageWindow(page?: number, limit?: number) {
  const safePage = page && page > 0 ? Math.floor(page) : 1;
  const safeLimit = Math.min(
    limit && limit > 0 ? Math.floor(limit) : DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  const skip = (safePage - 1) * safeLimit;
  if (!Number.isSafeInteger(skip)) {
    throw new BadRequestException('page is too large for a safe report offset');
  }
  return {
    page: safePage,
    limit: safeLimit,
    skip,
  };
}

function paginationMeta(total: number, page: number, limit: number) {
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

function dateAtDayOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function stockDateFilter(bucket?: string): Prisma.VehicleWhereInput {
  if (!bucket) return {};
  const bounds: Record<string, readonly [number, number | null]> = {
    '0_30': [30, null],
    '31_60': [60, 30],
    '61_90': [90, 60],
    '91_180': [180, 90],
    over_180: [Number.POSITIVE_INFINITY, 180],
    over_90: [Number.POSITIVE_INFINITY, 90],
  };
  const [olderThanDays, newerThanDays] = bounds[bucket];
  const dateRange = {
    ...(newerThanDays === null ? {} : { lt: dateAtDayOffset(newerThanDays) }),
    ...(Number.isFinite(olderThanDays)
      ? { gte: dateAtDayOffset(olderThanDays) }
      : {}),
  };
  return { stock_received_at: dateRange };
}

function validatePeriod(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  const isCalendarDate = (value: string, date: Date) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
  if (!isCalendarDate(from, start) || !isCalendarDate(to, end) || start > end) {
    throw new BadRequestException(
      'from and to must be valid ISO dates with from <= to',
    );
  }
  return { start, end };
}

function asDecimal(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? new Prisma.Decimal(0);
}

function averageDifference(
  first: Prisma.Decimal | null | undefined,
  second: Prisma.Decimal | null | undefined,
): string | null {
  if (
    first === null ||
    first === undefined ||
    second === null ||
    second === undefined
  ) {
    return null;
  }
  return first.sub(second).toDecimalPlaces(2).toFixed(2);
}

function averagePercent(
  margin: Prisma.Decimal,
  salePrice: Prisma.Decimal,
): string | null {
  if (salePrice.isZero()) return null;
  return calculateMarginPercent(margin, salePrice).toFixed(2);
}

@Injectable()
export class VehicleStockReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async stockAge(params: VehicleStockAgeReportQueryDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const { page, limit, skip } = pageWindow(params.page, params.limit);
    const baseWhere: Prisma.VehicleWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
      inventory_role: { in: [...DEALER_ROLES] },
      stock_status: { not: VehicleStockStatus.SOLD },
      ...(params.inventory_role
        ? { inventory_role: params.inventory_role }
        : {}),
      ...(params.stock_status ? { stock_status: params.stock_status } : {}),
    };
    const where: Prisma.VehicleWhereInput = {
      ...baseWhere,
      ...stockDateFilter(params.bucket),
    };
    const agedWhere: Prisma.VehicleWhereInput = {
      ...baseWhere,
      stock_received_at: { lt: dateAtDayOffset(90) },
    };
    const bucketNames = [
      '0_30',
      '31_60',
      '61_90',
      '91_180',
      'over_180',
    ] as const;
    const [vehicles, total, summary, bucketCountEntries] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: {
          location: { select: { id: true, name: true, site_id: true } },
          sales: {
            where: {
              tenant_id: tenantId,
              site_id: siteId,
              status: VehicleSaleStatus.DRAFT,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { sale_price: true },
          },
        },
        orderBy: [
          { stock_received_at: { sort: 'asc', nulls: 'last' } },
          { id: 'asc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.aggregate({
        where: agedWhere,
        _count: { id: true },
        _sum: { stock_cost_basis: true },
      }),
      Promise.all(
        bucketNames.map(
          async (bucket) =>
            [
              bucket,
              await this.prisma.vehicle.count({
                where: { ...baseWhere, ...stockDateFilter(bucket) },
              }),
            ] as const,
        ),
      ),
    ]);
    const bucketCounts = Object.fromEntries(bucketCountEntries) as Record<
      (typeof bucketNames)[number],
      number
    >;
    const asOf = new Date();
    return {
      data: vehicles.map((vehicle) => {
        const age = daysInStock(vehicle.stock_received_at, asOf);
        return {
          id: vehicle.id,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          vin: vehicle.vin,
          plate: vehicle.plate,
          inventory_role: vehicle.inventory_role,
          stock_status: vehicle.stock_status,
          days_in_stock: age,
          missing_stock_in_date: vehicle.stock_received_at === null,
          stock_in_date: vehicle.stock_received_at?.toISOString() ?? null,
          age_bucket: stockAgeBucket(age),
          cost_basis: asDecimal(vehicle.stock_cost_basis).toFixed(2),
          asking_price: vehicle.sales[0]?.sale_price.toFixed(2) ?? null,
          location: vehicle.location?.name ?? null,
        };
      }),
      meta: paginationMeta(total, page, limit),
      summary: {
        over_90_count: summary._count.id,
        over_90_cost_basis: asDecimal(summary._sum.stock_cost_basis).toFixed(2),
        bucket_counts: bucketCounts,
      },
    };
  }

  async margin(params: VehicleStockMarginReportQueryDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const { start, end } = validatePeriod(params.from, params.to);
    const { page, limit, skip } = pageWindow(params.page, params.limit);
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
      status: InvoiceStatus.FINALIZED,
      date: { gte: start, lte: end },
      credit_notes: { none: { tenant_id: tenantId, status: 'FINALIZED' } },
    };
    const saleWhere: Prisma.VehicleSaleWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
      status: VehicleSaleStatus.INVOICED,
      invoice: { is: invoiceWhere },
      vehicle: { tenant_id: tenantId },
    };
    const saleRelationWhere: Prisma.VehicleSaleWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
      status: VehicleSaleStatus.INVOICED,
      vehicle: { tenant_id: tenantId },
    };
    const invoiceWithSnapshotWhere: Prisma.InvoiceWhereInput = {
      ...invoiceWhere,
      vehicle_sale: {
        is: { ...saleRelationWhere, cost_basis_snapshot: { not: null } },
      },
    };
    const knownSnapshotWhere: Prisma.VehicleSaleWhereInput = {
      ...saleWhere,
      cost_basis_snapshot: { not: null },
    };
    const [
      sales,
      count,
      knownSnapshotCount,
      saleTotals,
      invoiceTotals,
      invoiceTotalsWithSnapshot,
    ] = await Promise.all([
      this.prisma.vehicleSale.findMany({
        where: saleWhere,
        include: {
          invoice: {
            select: { date: true, total_net: true, tax_mode: true },
          },
          vehicle: {
            select: { id: true, make: true, model: true, year: true },
          },
        },
        orderBy: [{ invoice: { date: 'desc' } }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.vehicleSale.count({ where: saleWhere }),
      this.prisma.vehicleSale.count({
        where: {
          ...knownSnapshotWhere,
          tenant_id: tenantId,
          site_id: siteId,
        },
      }),
      this.prisma.vehicleSale.aggregate({
        where: saleWhere,
        _sum: { cost_basis_snapshot: true },
        _avg: { cost_basis_snapshot: true, days_to_sell_snapshot: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          ...invoiceWhere,
          vehicle_sale: { is: saleRelationWhere },
        },
        _sum: { total_net: true },
        _avg: { total_net: true },
      }),
      this.prisma.invoice.aggregate({
        where: invoiceWithSnapshotWhere,
        _sum: { total_net: true },
        _avg: { total_net: true },
      }),
    ]);
    const costTotal = asDecimal(saleTotals._sum.cost_basis_snapshot);
    const netTotal = asDecimal(invoiceTotalsWithSnapshot._sum.total_net);
    const grossMarginTotal = netTotal.sub(costTotal);
    const grossMarginAverage = averageDifference(
      invoiceTotalsWithSnapshot._avg.total_net,
      saleTotals._avg.cost_basis_snapshot,
    );
    const summary = {
      gross_margin_total: grossMarginTotal.toFixed(2),
      gross_margin_average: grossMarginAverage,
      gross_margin_percent_average: averagePercent(grossMarginTotal, netTotal),
      sale_price_total: asDecimal(invoiceTotals._sum.total_net).toFixed(2),
      sale_price_average: invoiceTotals._avg.total_net?.toFixed(2) ?? null,
      cost_basis_total: costTotal.toFixed(2),
      cost_basis_average:
        saleTotals._avg.cost_basis_snapshot?.toFixed(2) ?? null,
      days_to_sell_average:
        saleTotals._avg.days_to_sell_snapshot?.toFixed(2) ?? null,
      gross_margin_known_count: knownSnapshotCount,
      gross_margin_unknown_count: count - knownSnapshotCount,
    };
    return {
      data: sales.map((sale) => {
        const salePrice = sale.invoice!.total_net;
        const cost = sale.cost_basis_snapshot;
        const margin = cost ? calculateGrossMargin(salePrice, cost) : null;
        return {
          id: sale.id,
          sale_number: sale.sale_number,
          vehicle_id: sale.vehicle_id,
          make: sale.vehicle.make,
          model: sale.vehicle.model,
          year: sale.vehicle.year,
          inventory_role: VehicleInventoryRole.USED,
          invoice_date: sale.invoice!.date.toISOString(),
          sale_price: salePrice.toFixed(2),
          cost_basis_snapshot: cost?.toFixed(2) ?? null,
          gross_margin_eur: margin?.toFixed(2) ?? null,
          gross_margin_percent: margin
            ? averagePercent(margin, salePrice)
            : null,
          days_to_sell: sale.days_to_sell_snapshot,
          margin_taxed: sale.invoice!.tax_mode === 'MARGIN_SCHEME',
        };
      }),
      meta: paginationMeta(count, page, limit),
      totals: {
        count,
        gross_margin_known_count: summary.gross_margin_known_count,
        gross_margin_unknown_count: summary.gross_margin_unknown_count,
        gross_margin_total: summary.gross_margin_total,
        gross_margin_average: summary.gross_margin_average,
        by_inventory_role: {
          USED: { count, ...summary },
          NEW: emptyRoleTotals(),
          DEMO: emptyRoleTotals(),
        },
      },
    };
  }
}

function emptyRoleTotals() {
  return {
    count: 0,
    gross_margin_known_count: 0,
    gross_margin_unknown_count: 0,
    gross_margin_total: '0.00',
    gross_margin_average: null,
    gross_margin_percent_average: null,
    sale_price_total: '0.00',
    sale_price_average: null,
    cost_basis_total: '0.00',
    cost_basis_average: null,
    days_to_sell_average: null,
  };
}
