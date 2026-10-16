import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { FinanceService } from '../finance/finance.service.js';
import { NovaCalculationService } from '../vehicle/nova-calculation.service.js';
import { VehicleService } from '../vehicle/vehicle.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { WorkshopKpiReportsService } from '../workshop/workshop-kpi-reports.service.js';
import { clampMcpPageSize } from './mcp-output.util.js';
import {
  offsetFromCursor,
  sortPickerlDueRows,
  toMcpNovaPreview,
  toMcpPageMeta,
  toMcpPickerlDueRow,
  toMcpRevenueReport,
  toMcpWorkshopKpiReport,
} from './mcp-report-read.mapper.js';
import type {
  getNovaPreviewInputSchema,
  getRevenueReportInputSchema,
  getWorkshopKpiReportInputSchema,
  listPickerlDueInputSchema,
} from './mcp-tool-schemas.js';

type WorkshopKpiInput = z.infer<typeof getWorkshopKpiReportInputSchema>;
type RevenueReportInput = z.infer<typeof getRevenueReportInputSchema>;
type PickerlDueInput = z.infer<typeof listPickerlDueInputSchema>;
type NovaPreviewInput = z.infer<typeof getNovaPreviewInputSchema>;

/** Pickerl windows the list accepts, in days. The domain applies the window; the default is 30. */
const DEFAULT_PICKERL_WINDOW_DAYS = 30;

/**
 * AUT-461 report reads: the workshop KPI report, the Pickerl due list, and the NoVA preview.
 * Each one calls its domain service, so the report math and tenant scoping stay there. The
 * site defaults to the active site, and an explicit site is authorized by the KPI report.
 * The NoVA preview is a calculation only; it writes nothing and sends nothing.
 */
@Injectable()
export class McpReportReadService {
  constructor(
    private readonly siteContext: SiteContextService,
    private readonly finance: FinanceService,
    private readonly vehicles: VehicleService,
    private readonly workshopKpis: WorkshopKpiReportsService,
    private readonly novaCalculation: NovaCalculationService,
  ) {}

  async getRevenueReport(input: RevenueReportInput) {
    const siteId = input.site_id ?? (await this.siteContext.getSiteId());
    const report = await this.finance.getRevenueReport({
      from: input.from,
      to: input.to,
      site_id: siteId,
      compare_previous: input.compare_previous,
    });
    return toMcpRevenueReport(report);
  }

  async getWorkshopKpiReport(input: WorkshopKpiInput) {
    const siteId = input.site_id ?? (await this.siteContext.getSiteId());
    const report = await this.workshopKpis.getReport({
      siteId,
      from: input.from,
      to: input.to,
      groupBy: 'mechanic',
    });
    return toMcpWorkshopKpiReport(report, siteId);
  }

  async listPickerlDue(input: PickerlDueInput) {
    const windowDays = input.window ?? DEFAULT_PICKERL_WINDOW_DAYS;
    const scope = {
      offset: offsetFromCursor(input.cursor),
      pageSize: clampMcpPageSize(input.pageSize),
    };
    const rows = sortPickerlDueRows(
      await this.vehicles.getPickerlDueData({ window: windowDays }),
    );
    return {
      window_days: windowDays,
      data: rows
        .slice(scope.offset, scope.offset + scope.pageSize)
        .map(toMcpPickerlDueRow),
      meta: toMcpPageMeta(rows.length, scope),
    };
  }

  async getNovaPreview(input: NovaPreviewInput) {
    const netPriceEur = Number(input.net_price_eur);
    const result = await this.novaCalculation.calculate({
      vehicleId: input.vehicle_id,
      netPriceEuro: netPriceEur,
    });
    return toMcpNovaPreview(
      { vehicleId: input.vehicle_id, netPriceEur },
      result,
    );
  }
}
