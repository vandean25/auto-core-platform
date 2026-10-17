import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WorkshopEstimateStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import { FinanceService } from '../../finance/finance.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { WorkshopKpiReportsService } from '../../workshop/workshop-kpi-reports.service.js';
import { localDateStartUtc } from '../../workshop/workshop-kpi-reports.math.js';
import type { WeeklyReportPeriod } from './weekly-report-period.util.js';

export type WeeklyReportOpenEstimateRow = {
  order_number: string;
  estimate_number: string;
  sent_at: string;
  valid_until: string | null;
  total_gross: string;
};

export type WeeklyReportCompletedOrderRow = {
  order_number: string;
  completed_at: string;
  vehicle_label: string;
};

export type WeeklyReportData = {
  period: WeeklyReportPeriod & { timezone: string };
  site: { id: string; name: string; timezone: string };
  revenue: Awaited<ReturnType<FinanceService['getRevenueReport']>>;
  workshop_kpis: Awaited<ReturnType<WorkshopKpiReportsService['getReport']>>;
  open_estimates: WeeklyReportOpenEstimateRow[];
  completed_orders: WeeklyReportCompletedOrderRow[];
};

@Injectable()
export class WeeklyReportDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly finance: FinanceService,
    private readonly workshopKpis: WorkshopKpiReportsService,
  ) {}

  async load(params: {
    siteId: string;
    timeZone: string;
    period: WeeklyReportPeriod;
  }): Promise<WeeklyReportData> {
    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.prisma.site.findFirst({
      where: { id: params.siteId, tenant_id: tenantId, is_active: true },
      select: { id: true, name: true, timezone: true },
    });
    if (!site) {
      throw new Error('site missing');
    }

    const [revenue, workshop_kpis, open_estimates, completed_orders] =
      await Promise.all([
        this.finance.getRevenueReport({
          from: params.period.from,
          to: params.period.to,
          site_id: params.siteId,
          compare_previous: false,
          enforce_report_role: false,
        }),
        this.workshopKpis.getReport({
          siteId: params.siteId,
          from: params.period.from,
          to: params.period.to,
          groupBy: 'mechanic',
        }),
        this.loadOpenEstimates(tenantId, params.siteId),
        this.loadCompletedOrders(
          tenantId,
          params.siteId,
          params.period,
          params.timeZone,
        ),
      ]);

    return {
      period: { ...params.period, timezone: params.timeZone },
      site: { id: site.id, name: site.name, timezone: site.timezone },
      revenue,
      workshop_kpis,
      open_estimates,
      completed_orders,
    };
  }

  private async loadOpenEstimates(tenantId: string, siteId: string) {
    const now = new Date();
    const rows = await this.prisma.workshopOrder.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        estimates: {
          some: {
            versions: {
              some: {
                status: WorkshopEstimateStatus.SENT,
                OR: [{ valid_until: null }, { valid_until: { gte: now } }],
              },
            },
          },
        },
      },
      select: {
        order_number: true,
        estimates: {
          select: {
            estimate_number: true,
            versions: {
              where: { status: WorkshopEstimateStatus.SENT },
              orderBy: { version: 'desc' },
              take: 1,
              select: {
                sent_at: true,
                valid_until: true,
                total_gross: true,
              },
            },
          },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    return rows
      .map((row) => {
        const estimate = row.estimates[0];
        const version = estimate?.versions[0];
        if (!estimate || !version?.sent_at) {
          return null;
        }
        return {
          order_number: row.order_number,
          estimate_number: estimate.estimate_number,
          sent_at: version.sent_at.toISOString(),
          valid_until: version.valid_until?.toISOString().slice(0, 10) ?? null,
          total_gross: version.total_gross
            ? decimalToString(version.total_gross)
            : '0.00',
        };
      })
      .filter((row): row is WeeklyReportOpenEstimateRow => row !== null);
  }

  private async loadCompletedOrders(
    tenantId: string,
    siteId: string,
    period: WeeklyReportPeriod,
    timeZone: string,
  ) {
    const rangeStart = localDateStartUtc(period.from, timeZone);
    const rangeEnd = localDateStartUtc(
      addIsoDay(period.to, 1),
      timeZone,
    );
    const rows = await this.prisma.workshopOrder.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        status: WorkshopOrderStatus.COMPLETED,
        updatedAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: {
        order_number: true,
        updatedAt: true,
        vehicle: { select: { make: true, model: true, plate: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return rows.map((row) => ({
      order_number: row.order_number,
      completed_at: row.updatedAt.toISOString(),
      vehicle_label: formatVehicleLabel(row.vehicle),
    }));
  }
}

function decimalToString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function formatVehicleLabel(vehicle: {
  make: string | null;
  model: string | null;
  plate: string | null;
}): string {
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  if (vehicle.plate) {
    return name ? `${name} (${vehicle.plate})` : vehicle.plate;
  }
  return name || '–';
}

function addIsoDay(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
