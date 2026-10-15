import { NotFoundException } from '@nestjs/common';
import type { NovaCalculationService } from '../vehicle/nova-calculation.service.js';
import type { VehicleService } from '../vehicle/vehicle.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { WorkshopKpiReportsService } from '../workshop/workshop-kpi-reports.service.js';
import { encodeMcpCursor } from './mcp-output.util.js';
import { McpReportReadService } from './mcp-report-read.service.js';

const SITE_ACTIVE = '00000000-0000-4000-8000-0000000000a1';
const SITE_REQUESTED = '00000000-0000-4000-8000-0000000000a9';
const VEHICLE_ID = '00000000-0000-4000-8000-0000000000c1';

function dueRow(index: number, status: 'OVERDUE' | 'DUE_SOON' = 'DUE_SOON') {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    id,
    make: 'VW',
    model: 'Golf',
    plate: null,
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Erika',
      last_name: 'Musterfrau',
    },
    pickerl_due: { due_month: '2026-11', status },
  };
}

describe('McpReportReadService', () => {
  let service: McpReportReadService;
  let siteContext: { getSiteId: jest.Mock };
  let vehicles: { getPickerlDueData: jest.Mock };
  let workshopKpis: { getReport: jest.Mock };
  let novaCalculation: { calculate: jest.Mock };

  beforeEach(() => {
    siteContext = { getSiteId: jest.fn().mockResolvedValue(SITE_ACTIVE) };
    vehicles = { getPickerlDueData: jest.fn().mockResolvedValue([]) };
    workshopKpis = {
      getReport: jest.fn().mockResolvedValue({
        data: [],
        meta: {
          from: '2026-10-01',
          to: '2026-10-31',
          timezone: 'Europe/Vienna',
          groupBy: 'mechanic',
          unassigned_mechanic_count: 0,
        },
        totals: {
          utilisation_percent: null,
          productivity_percent: null,
          average_net_revenue_per_order: null,
          closed_orders: 0,
          labor_net_revenue: '0.00',
          parts_net_revenue: '0.00',
          available_hours: '0.00',
          clocked_hours: '0.00',
          sold_hours: '0.00',
          open_labor_entry_count: 0,
        },
        parts_turnover: {
          issued_cost: '0.00',
          average_stock_value: null,
          turnover: null,
          unvalued_stock_item_count: 0,
          slow_movers: [],
        },
      }),
    };
    novaCalculation = {
      calculate: jest.fn().mockResolvedValue({
        novaAmountEuro: 900,
        tariffVersionId: 'tariff-2026-01',
        appliedRuleIds: [],
        warnings: [],
        ratePercentApplied: 16,
        effectiveCo2GramsPerKm: 0,
        hasUnverifiedRules: false,
        hasScopeLimitations: false,
      }),
    };
    service = new McpReportReadService(
      siteContext as unknown as SiteContextService,
      vehicles as unknown as VehicleService,
      workshopKpis as unknown as WorkshopKpiReportsService,
      novaCalculation as unknown as NovaCalculationService,
    );
  });

  describe('get_workshop_kpi_report', () => {
    it('reports the active site and the period when no site is given', async () => {
      const kpi = await service.getWorkshopKpiReport({
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(siteContext.getSiteId).toHaveBeenCalledTimes(1);
      expect(workshopKpis.getReport).toHaveBeenCalledWith({
        siteId: SITE_ACTIVE,
        from: '2026-10-01',
        to: '2026-10-31',
        groupBy: 'mechanic',
      });
      expect(kpi.site_id).toBe(SITE_ACTIVE);
    });

    it('passes an explicit site through, so the domain authorizes it', async () => {
      await service.getWorkshopKpiReport({
        from: '2026-10-01',
        to: '2026-10-31',
        site_id: SITE_REQUESTED,
      });

      expect(siteContext.getSiteId).not.toHaveBeenCalled();
      expect(workshopKpis.getReport).toHaveBeenCalledWith(
        expect.objectContaining({ siteId: SITE_REQUESTED }),
      );
    });

    it('passes a site the caller is not authorized for to the domain as a not-found error', async () => {
      workshopKpis.getReport.mockRejectedValue(
        new NotFoundException('Workshop KPI report site not found'),
      );

      await expect(
        service.getWorkshopKpiReport({
          from: '2026-10-01',
          to: '2026-10-31',
          site_id: SITE_REQUESTED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list_pickerl_due', () => {
    it('uses a 30 day window by default and passes nothing else to the domain', async () => {
      const list = await service.listPickerlDue({});

      expect(vehicles.getPickerlDueData).toHaveBeenCalledWith({ window: 30 });
      expect(list.window_days).toBe(30);
      expect(list.data).toEqual([]);
      expect(list.meta).toEqual({ total: 0, page_size: 10, next_cursor: null });
    });

    it('passes the 60 and 90 day windows through', async () => {
      await service.listPickerlDue({ window: 60 });
      await service.listPickerlDue({ window: 90 });

      expect(vehicles.getPickerlDueData).toHaveBeenNthCalledWith(1, {
        window: 60,
      });
      expect(vehicles.getPickerlDueData).toHaveBeenNthCalledWith(2, {
        window: 90,
      });
    });

    it('pages 27 rows by pageSize with an opaque cursor until the last page', async () => {
      vehicles.getPickerlDueData.mockResolvedValue(
        Array.from({ length: 27 }, (_, index) => dueRow(index + 1)),
      );

      const first = await service.listPickerlDue({ pageSize: 10 });
      const second = await service.listPickerlDue({
        pageSize: 10,
        cursor: first.meta.next_cursor ?? undefined,
      });
      const last = await service.listPickerlDue({
        pageSize: 10,
        cursor: second.meta.next_cursor ?? undefined,
      });

      expect(first.data).toHaveLength(10);
      expect(first.meta).toMatchObject({ total: 27, page_size: 10 });
      expect(second.data[0]?.vehicle.id).toBe(dueRow(11).id);
      expect(last.data).toHaveLength(7);
      expect(last.meta.next_cursor).toBeNull();
    });

    it('caps the page at 25 rows even if a larger pageSize reaches the service', async () => {
      vehicles.getPickerlDueData.mockResolvedValue(
        Array.from({ length: 30 }, (_, index) => dueRow(index + 1)),
      );

      const list = await service.listPickerlDue({ pageSize: 30 });

      expect(list.data).toHaveLength(25);
      expect(list.meta).toMatchObject({ total: 30, page_size: 25 });
      expect(list.meta.next_cursor).not.toBeNull();
    });

    it('lists overdue vehicles first, whatever order the domain returned', async () => {
      vehicles.getPickerlDueData.mockResolvedValue([
        dueRow(1, 'DUE_SOON'),
        dueRow(2, 'OVERDUE'),
      ]);

      const list = await service.listPickerlDue({});

      expect(list.data.map((row) => row.status)).toEqual([
        'OVERDUE',
        'DUE_SOON',
      ]);
    });

    it('returns an empty page with no next cursor for an offset past the total', async () => {
      vehicles.getPickerlDueData.mockResolvedValue([dueRow(1)]);

      const list = await service.listPickerlDue({
        cursor: encodeMcpCursor(50),
      });

      expect(list.data).toEqual([]);
      expect(list.meta.next_cursor).toBeNull();
    });
  });

  describe('get_nova_preview', () => {
    it('calculates for the vehicle at the net price and returns EUR strings with the note', async () => {
      const preview = await service.getNovaPreview({
        vehicle_id: VEHICLE_ID,
        net_price_eur: '12000',
      });

      expect(novaCalculation.calculate).toHaveBeenCalledWith({
        vehicleId: VEHICLE_ID,
        netPriceEuro: 12000,
      });
      expect(preview).toMatchObject({
        vehicle_id: VEHICLE_ID,
        net_price_eur: '12000.00',
        nova_eur: '900.00',
      });
      expect(preview.note).toMatch(/Steuerberater must still confirm/);
    });

    it('states the unconfirmed-rule condition when the domain reports one', async () => {
      novaCalculation.calculate.mockResolvedValue({
        novaAmountEuro: 900,
        tariffVersionId: 'tariff-2026-01',
        appliedRuleIds: [],
        warnings: ['fractional_co2_unverified'],
        ratePercentApplied: 16,
        effectiveCo2GramsPerKm: 0,
        hasUnverifiedRules: true,
        hasScopeLimitations: false,
      });

      const preview = await service.getNovaPreview({
        vehicle_id: VEHICLE_ID,
        net_price_eur: '12000.00',
      });

      expect(preview.has_unverified_rules).toBe(true);
      expect(preview.note).toMatch(/An unconfirmed rule applies/);
    });

    it('does not find a vehicle of another tenant: the domain not-found error reaches the caller', async () => {
      novaCalculation.calculate.mockRejectedValue(
        new NotFoundException('Vehicle not found'),
      );

      await expect(
        service.getNovaPreview({
          vehicle_id: VEHICLE_ID,
          net_price_eur: '12000.00',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
