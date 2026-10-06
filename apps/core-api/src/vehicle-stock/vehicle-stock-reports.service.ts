import { BadRequestException, Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  VehicleInventoryRole,
  VehiclePurchaseStatus,
  VehicleSaleStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { costBasis } from './vehicle-cost.js';
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
  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
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

function validatePeriod(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    Number.isNaN(start.valueOf()) ||
    Number.isNaN(end.valueOf()) ||
    start > end
  ) {
    throw new BadRequestException(
      'from and to must be valid ISO dates with from <= to',
    );
  }
  return { start, end };
}

function average(values: Prisma.Decimal[]): Prisma.Decimal | null {
  if (values.length === 0) return null;
  return values
    .reduce((sum, value) => sum.add(value), new Prisma.Decimal(0))
    .div(values.length)
    .toDecimalPlaces(2);
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
    const asOf = new Date();
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        inventory_role: { in: [...DEALER_ROLES] },
        stock_status: { not: VehicleStockStatus.SOLD },
      },
      include: {
        location: { select: { id: true, name: true, site_id: true } },
        purchases: {
          where: {
            tenant_id: tenantId,
            site_id: siteId,
            status: VehiclePurchaseStatus.RECEIVED,
          },
          orderBy: [{ received_at: 'asc' }, { createdAt: 'asc' }],
          select: { received_at: true },
        },
        ledger_entries: {
          where: { tenant_id: tenantId },
          orderBy: { posting_date: 'asc' },
          select: { entry_type: true, amount: true, posting_date: true },
        },
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
    });

    const allRows = vehicles
      .map((vehicle) => {
        const receivedDate =
          vehicle.purchases.find((purchase) => purchase.received_at)
            ?.received_at ?? null;
        const purchasePostingDate =
          vehicle.ledger_entries.find(
            (entry) => entry.entry_type === 'PURCHASE',
          )?.posting_date ?? null;
        const stockInDate = receivedDate ?? purchasePostingDate;
        const age = daysInStock(stockInDate, asOf);
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
          missing_stock_in_date: stockInDate === null,
          stock_in_date: stockInDate?.toISOString() ?? null,
          age_bucket: stockAgeBucket(age),
          cost_basis: costBasis(vehicle.ledger_entries).toFixed(2),
          asking_price: vehicle.sales[0]?.sale_price.toFixed(2) ?? null,
          location: vehicle.location?.name ?? null,
        };
      })
      .sort(
        (left, right) =>
          (right.days_in_stock ?? -1) - (left.days_in_stock ?? -1),
      );
    const rows = allRows.filter(
      (row) =>
        (!params.inventory_role ||
          row.inventory_role === params.inventory_role) &&
        (!params.stock_status || row.stock_status === params.stock_status) &&
        (!params.bucket ||
          (params.bucket === 'over_90'
            ? row.days_in_stock !== null && row.days_in_stock > 90
            : row.age_bucket === params.bucket)),
    );
    const agedOverNinety = allRows.filter(
      (row) => row.days_in_stock !== null && row.days_in_stock > 90,
    );

    return {
      data: rows.slice(skip, skip + limit),
      meta: paginationMeta(rows.length, page, limit),
      summary: {
        over_90_count: agedOverNinety.length,
        over_90_cost_basis: agedOverNinety
          .reduce((sum, row) => sum.add(row.cost_basis), new Prisma.Decimal(0))
          .toFixed(2),
      },
    };
  }

  async margin(params: VehicleStockMarginReportQueryDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const { start, end } = validatePeriod(params.from, params.to);
    const { page, limit, skip } = pageWindow(params.page, params.limit);
    const sales = await this.prisma.vehicleSale.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        status: VehicleSaleStatus.INVOICED,
        invoice: {
          tenant_id: tenantId,
          site_id: siteId,
          status: InvoiceStatus.FINALIZED,
          date: { gte: start, lte: end },
          credit_notes: { none: { tenant_id: tenantId, status: 'FINALIZED' } },
        },
        vehicle: {
          tenant_id: tenantId,
          site_id: siteId,
          location: { site_id: siteId },
        },
      },
      include: {
        invoice: { select: { date: true, tax_mode: true } },
        vehicle: {
          select: {
            id: true,
            make: true,
            model: true,
            year: true,
            inventory_role: true,
            purchases: {
              where: {
                tenant_id: tenantId,
                site_id: siteId,
                status: VehiclePurchaseStatus.RECEIVED,
              },
              orderBy: [{ received_at: 'asc' }, { createdAt: 'asc' }],
              select: { received_at: true },
            },
            ledger_entries: {
              where: { tenant_id: tenantId, entry_type: 'PURCHASE' },
              orderBy: { posting_date: 'asc' },
              take: 1,
              select: { posting_date: true },
            },
          },
        },
      },
      orderBy: [{ invoice: { date: 'desc' } }, { createdAt: 'desc' }],
    });

    const marginBySaleId = new Map<string, Prisma.Decimal | null>();
    const marginPercentBySaleId = new Map<string, Prisma.Decimal | null>();
    const rows = sales.map((sale) => {
      const costSnapshot = sale.cost_basis_snapshot;
      const margin = costSnapshot
        ? calculateGrossMargin(sale.sale_price, costSnapshot)
        : null;
      const marginPercent =
        margin && sale.sale_price.gt(0)
          ? calculateMarginPercent(margin, sale.sale_price)
          : null;
      marginBySaleId.set(sale.id, margin);
      marginPercentBySaleId.set(sale.id, marginPercent);
      const stockInDate =
        sale.vehicle.purchases.find((purchase) => purchase.received_at)
          ?.received_at ??
        sale.vehicle.ledger_entries[0]?.posting_date ??
        null;
      return {
        id: sale.id,
        sale_number: sale.sale_number,
        vehicle_id: sale.vehicle_id,
        make: sale.vehicle.make,
        model: sale.vehicle.model,
        year: sale.vehicle.year,
        inventory_role: VehicleInventoryRole.USED,
        invoice_date: sale.invoice!.date.toISOString(),
        sale_price: sale.sale_price.toFixed(2),
        cost_basis_snapshot: costSnapshot?.toFixed(2) ?? null,
        gross_margin_eur: margin?.toFixed(2) ?? null,
        gross_margin_percent:
          margin && sale.sale_price.gt(0)
            ? calculateMarginPercent(margin, sale.sale_price).toFixed(2)
            : null,
        days_to_sell: daysInStock(stockInDate, sale.invoice!.date),
        margin_taxed: sale.invoice!.tax_mode === 'MARGIN_SCHEME',
      };
    });
    const roleTotals = Object.fromEntries(
      DEALER_ROLES.map((role) => {
        const roleRows = rows.filter((row) => row.inventory_role === role);
        const margins = roleRows.flatMap((row) => {
          const margin = marginBySaleId.get(row.id);
          return margin ? [margin] : [];
        });
        const totalMargin = margins.reduce(
          (sum, value) => sum.add(value),
          new Prisma.Decimal(0),
        );
        const salePrices = roleRows.map(
          (row) => new Prisma.Decimal(row.sale_price),
        );
        const costSnapshots = roleRows.flatMap((row) =>
          row.cost_basis_snapshot
            ? [new Prisma.Decimal(row.cost_basis_snapshot)]
            : [],
        );
        const marginPercentages = roleRows.flatMap((row) => {
          const marginPercent = marginPercentBySaleId.get(row.id);
          return marginPercent ? [marginPercent] : [];
        });
        return [
          role,
          {
            count: roleRows.length,
            gross_margin_total: totalMargin.toFixed(2),
            gross_margin_average: average(margins)?.toFixed(2) ?? null,
            gross_margin_percent_average:
              average(marginPercentages)?.toFixed(2) ?? null,
            sale_price_total: salePrices
              .reduce((sum, value) => sum.add(value), new Prisma.Decimal(0))
              .toFixed(2),
            sale_price_average: average(salePrices)?.toFixed(2) ?? null,
            cost_basis_total: costSnapshots
              .reduce((sum, value) => sum.add(value), new Prisma.Decimal(0))
              .toFixed(2),
            cost_basis_average: average(costSnapshots)?.toFixed(2) ?? null,
            days_to_sell_average: roleRows.some(
              (row) => row.days_to_sell !== null,
            )
              ? (
                  roleRows.reduce(
                    (sum, row) => sum + (row.days_to_sell ?? 0),
                    0,
                  ) / roleRows.filter((row) => row.days_to_sell !== null).length
                ).toFixed(2)
              : null,
          },
        ];
      }),
    );
    return {
      data: rows.slice(skip, skip + limit),
      meta: paginationMeta(rows.length, page, limit),
      totals: {
        count: rows.length,
        gross_margin_total: rows
          .reduce(
            (sum, row) =>
              sum.add(marginBySaleId.get(row.id) ?? new Prisma.Decimal(0)),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
        gross_margin_average:
          average(
            rows.flatMap((row) => {
              const margin = marginBySaleId.get(row.id);
              return margin ? [margin] : [];
            }),
          )?.toFixed(2) ?? null,
        by_inventory_role: roleTotals,
      },
    };
  }
}
