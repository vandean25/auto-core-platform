import type { NovaCalculateResult } from '../vehicle/nova-calculation.service.js';
import type { McpInvoiceCustomer } from './mcp-invoice-read.mapper.js';
import type { VehicleStockReportsService } from '../vehicle-stock/vehicle-stock-reports.service.js';
import type { WorkshopKpiReportsService } from '../workshop/workshop-kpi-reports.service.js';
import { decodeMcpCursor } from './mcp-output.util.js';
import {
  novaPreviewNote,
  offsetFromCursor,
  sortPickerlDueRows,
  toMcpNovaPreview,
  toMcpPageMeta,
  toMcpPickerlDueRow,
  toMcpStockAgeReport,
  toMcpStockMarginReport,
  toMcpWorkshopKpiReport,
  type McpPickerlDueVehicle,
} from './mcp-report-read.mapper.js';

const SITE_ID = '00000000-0000-4000-8000-0000000000a1';
const VEHICLE_A = '00000000-0000-4000-8000-0000000000a2';
const VEHICLE_B = '00000000-0000-4000-8000-0000000000b2';
const VEHICLE_C = '00000000-0000-4000-8000-0000000000c2';

const PERSON: Pick<
  McpInvoiceCustomer,
  'type' | 'company_name' | 'first_name' | 'last_name'
> = {
  type: 'PRIVATE',
  company_name: null,
  first_name: 'Erika',
  last_name: 'Musterfrau',
};
const COMPANY: Pick<
  McpInvoiceCustomer,
  'type' | 'company_name' | 'first_name' | 'last_name'
> = {
  type: 'COMPANY',
  company_name: 'Musterwerkstatt Nord GmbH',
  first_name: 'Max',
  last_name: 'Muster',
};

function novaResult(
  overrides: Partial<NovaCalculateResult> & {
    hasUnverifiedRules?: boolean;
  } = {},
) {
  return {
    novaAmountEuro: 1234.5,
    tariffVersionId: 'tariff-2026-01',
    appliedRuleIds: ['rule-co2-wltp'],
    warnings: [],
    ratePercentApplied: 16,
    effectiveCo2GramsPerKm: 120,
    hasUnverifiedRules: false,
    hasScopeLimitations: false,
    ...overrides,
  } as NovaCalculateResult;
}

function pickerlVehicle(
  overrides: Partial<McpPickerlDueVehicle> & { id: string },
): McpPickerlDueVehicle {
  return {
    make: 'VW',
    model: 'Golf',
    plate: 'W-AB 123',
    customer: PERSON,
    pickerl_due: { due_month: '2026-11', status: 'DUE_SOON' },
    ...overrides,
  };
}

describe('novaPreviewNote', () => {
  it('always names the Steuerberater and the unconfirmed-rule condition', () => {
    expect(novaPreviewNote(false)).toMatch(/Steuerberater/);
    expect(novaPreviewNote(false)).toMatch(
      /while any unconfirmed rule applies/,
    );
  });

  it('adds the confirmation requirement while an unconfirmed rule applies', () => {
    const note = novaPreviewNote(true);

    expect(note.startsWith(novaPreviewNote(false))).toBe(true);
    expect(note).toMatch(/An unconfirmed rule applies/);
    expect(note).toMatch(/Steuerberater must confirm/);
  });
});

describe('toMcpNovaPreview', () => {
  it('returns amounts as two-place EUR decimal strings', () => {
    const preview = toMcpNovaPreview(
      { vehicleId: VEHICLE_A, netPriceEur: 12000 },
      novaResult(),
    );

    expect(preview).toMatchObject({
      vehicle_id: VEHICLE_A,
      net_price_eur: '12000.00',
      nova_eur: '1234.50',
      rate_percent: 16,
      effective_co2_g_km: 120,
      tariff_version_id: 'tariff-2026-01',
      applied_rule_ids: ['rule-co2-wltp'],
      has_unverified_rules: false,
    });
  });

  it('carries the warnings and always includes the note', () => {
    const preview = toMcpNovaPreview(
      { vehicleId: VEHICLE_A, netPriceEur: 9999.9 },
      novaResult({
        warnings: ['nedc_fractional_co2_unverified'],
        hasUnverifiedRules: true,
      }),
    );

    expect(preview.warnings).toEqual(['nedc_fractional_co2_unverified']);
    expect(preview.has_unverified_rules).toBe(true);
    expect(preview.net_price_eur).toBe('9999.90');
    expect(preview.note).toBe(novaPreviewNote(true));
  });
});

describe('toMcpPickerlDueRow', () => {
  it('reports the last day of the due month as the due date', () => {
    expect(toMcpPickerlDueRow(pickerlVehicle({ id: VEHICLE_A })).due_date).toBe(
      '2026-11-30',
    );
    expect(
      toMcpPickerlDueRow(
        pickerlVehicle({
          id: VEHICLE_A,
          pickerl_due: { due_month: '2028-02', status: 'OK' },
        }),
      ).due_date,
    ).toBe('2028-02-29');
  });

  it('names a company by its company name and a person by first and last name', () => {
    expect(
      toMcpPickerlDueRow(pickerlVehicle({ id: VEHICLE_A, customer: COMPANY }))
        .customer_name,
    ).toBe('Musterwerkstatt Nord GmbH');
    expect(
      toMcpPickerlDueRow(pickerlVehicle({ id: VEHICLE_A })).customer_name,
    ).toBe('Erika Musterfrau');
  });

  it('keeps only the vehicle identity and the name, never contact data', () => {
    const row = toMcpPickerlDueRow(pickerlVehicle({ id: VEHICLE_A }));

    expect(Object.keys(row).sort()).toEqual([
      'customer_name',
      'due_date',
      'status',
      'vehicle',
    ]);
    expect(Object.keys(row.vehicle).sort()).toEqual([
      'id',
      'make',
      'model',
      'plate',
    ]);
  });

  it('returns null for a missing customer or due month', () => {
    const row = toMcpPickerlDueRow(
      pickerlVehicle({
        id: VEHICLE_A,
        customer: null,
        pickerl_due: { due_month: null, status: 'OVERDUE' },
      }),
    );

    expect(row.customer_name).toBeNull();
    expect(row.due_date).toBeNull();
  });
});

describe('sortPickerlDueRows', () => {
  it('lists overdue first, then by due month, and breaks ties by vehicle ID without changing the input', () => {
    const rows = [
      pickerlVehicle({
        id: VEHICLE_C,
        pickerl_due: { due_month: '2026-12', status: 'DUE_SOON' },
      }),
      pickerlVehicle({
        id: VEHICLE_B,
        pickerl_due: { due_month: '2026-10', status: 'OVERDUE' },
      }),
      pickerlVehicle({
        id: VEHICLE_A,
        pickerl_due: { due_month: '2026-12', status: 'DUE_SOON' },
      }),
      pickerlVehicle({
        id: VEHICLE_C,
        pickerl_due: { due_month: null, status: 'UNKNOWN' },
      }),
    ];
    const before = rows.map((row) => row.id);

    const sorted = sortPickerlDueRows(rows);

    expect(sorted.map((row) => `${row.pickerl_due.status}:${row.id}`)).toEqual([
      `OVERDUE:${VEHICLE_B}`,
      `DUE_SOON:${VEHICLE_A}`,
      `DUE_SOON:${VEHICLE_C}`,
      `UNKNOWN:${VEHICLE_C}`,
    ]);
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe('paging helpers', () => {
  it('marks the last page with a null cursor and points earlier pages at the next offset', () => {
    expect(
      toMcpPageMeta(30, { offset: 0, pageSize: 25 }).next_cursor,
    ).not.toBeNull();
    expect(toMcpPageMeta(30, { offset: 25, pageSize: 25 })).toEqual({
      total: 30,
      page_size: 25,
      next_cursor: null,
    });
  });

  it('encodes the next offset as an opaque cursor that round-trips', () => {
    const { next_cursor: cursor } = toMcpPageMeta(60, {
      offset: 10,
      pageSize: 25,
    });

    expect(cursor).toEqual(expect.any(String));
    expect(decodeMcpCursor(cursor as string)).toBe(35);
    expect(offsetFromCursor(cursor as string)).toBe(35);
    expect(offsetFromCursor(undefined)).toBe(0);
  });
});

describe('toMcpWorkshopKpiReport', () => {
  it('maps the period totals and parts turnover, and drops per-mechanic rows and slow movers', () => {
    const report = {
      data: [{ key: 'mechanic-1' }],
      meta: {
        from: '2026-10-01',
        to: '2026-10-31',
        timezone: 'Europe/Vienna',
        groupBy: 'mechanic',
        unassigned_mechanic_count: 1,
      },
      totals: {
        utilisation_percent: '72.50',
        productivity_percent: '88.00',
        average_net_revenue_per_order: '410.25',
        closed_orders: 12,
        labor_net_revenue: '3200.00',
        parts_net_revenue: '1800.00',
        available_hours: '160.00',
        clocked_hours: '116.00',
        sold_hours: '102.00',
        open_labor_entry_count: 0,
      },
      parts_turnover: {
        issued_cost: '900.00',
        average_stock_value: '4500.00',
        turnover: '0.20',
        unvalued_stock_item_count: 2,
        slow_movers: [{ sku: 'SLOW-1' }],
      },
    } as unknown as Awaited<ReturnType<WorkshopKpiReportsService['getReport']>>;

    const kpi = toMcpWorkshopKpiReport(report, SITE_ID);

    expect(kpi).toEqual({
      site_id: SITE_ID,
      period: {
        from: '2026-10-01',
        to: '2026-10-31',
        timezone: 'Europe/Vienna',
      },
      utilisation_percent: '72.50',
      productivity_percent: '88.00',
      revenue_per_order: '410.25',
      closed_orders: 12,
      labor_net_revenue: '3200.00',
      parts_net_revenue: '1800.00',
      available_hours: '160.00',
      clocked_hours: '116.00',
      sold_hours: '102.00',
      open_labor_entry_count: 0,
      unassigned_mechanic_count: 1,
      parts_turnover: {
        issued_cost: '900.00',
        average_stock_value: '4500.00',
        turnover: '0.20',
        unvalued_stock_item_count: 2,
      },
    });
    expect(JSON.stringify(kpi)).not.toContain('SLOW-1');
  });
});

describe('stock report shapes', () => {
  const scope = { siteId: SITE_ID, offset: 0, pageSize: 1 };

  it('compacts the stock age envelope and keeps the stock-in window as the period', () => {
    const report = {
      data: [
        {
          id: VEHICLE_A,
          make: 'Audi',
          model: 'A4',
          year: 2020,
          vin: null,
          plate: 'W-CD 456',
          inventory_role: 'USED',
          stock_status: 'IN_STOCK',
          days_in_stock: 95,
          missing_stock_in_date: false,
          stock_in_date: '2026-07-01T00:00:00.000Z',
          age_bucket: '91_180',
          cost_basis: '10300.00',
          asking_price: '12900.00',
          location: 'Halle 1',
        },
      ],
      meta: {
        total: 3,
        page: 1,
        limit: 1,
        pageSize: 1,
        totalPages: 3,
        pageCount: 3,
      },
      summary: {
        over_90_count: 2,
        over_90_cost_basis: '18000.00',
        bucket_counts: {
          '0_30': 1,
          '31_60': 0,
          '61_90': 0,
          '91_180': 2,
          over_180: 0,
        },
      },
    } as unknown as Awaited<ReturnType<VehicleStockReportsService['stockAge']>>;

    const stockAge = toMcpStockAgeReport(report, {
      ...scope,
      from: '2026-07-01',
      to: '2026-07-31',
    });

    expect(stockAge.period).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(stockAge.totals).toEqual({
      over_90_count: 2,
      over_90_cost_basis: '18000.00',
      bucket_counts: {
        '0_30': 1,
        '31_60': 0,
        '61_90': 0,
        '91_180': 2,
        over_180: 0,
      },
    });
    expect(stockAge.meta).toEqual({
      total: 3,
      page_size: 1,
      next_cursor: expect.any(String),
    });
    expect(stockAge.data[0]).toMatchObject({
      cost_basis: '10300.00',
      asking_price: '12900.00',
    });
    expect(stockAge).not.toHaveProperty('summary');
  });

  it('reports no period for an unbounded stock age report', () => {
    const report = {
      data: [],
      meta: {
        total: 0,
        page: 1,
        limit: 1,
        pageSize: 1,
        totalPages: 0,
        pageCount: 0,
      },
      summary: {
        over_90_count: 0,
        over_90_cost_basis: '0.00',
        bucket_counts: {
          '0_30': 0,
          '31_60': 0,
          '61_90': 0,
          '91_180': 0,
          over_180: 0,
        },
      },
    } as unknown as Awaited<ReturnType<VehicleStockReportsService['stockAge']>>;

    expect(toMcpStockAgeReport(report, scope).period).toBeNull();
  });

  it('takes the margin totals from the USED block and drops the per-role blocks and the role column', () => {
    const used = {
      count: 2,
      gross_margin_known_count: 2,
      gross_margin_unknown_count: 0,
      gross_margin_total: '2100.00',
      gross_margin_average: '1050.00',
      gross_margin_percent_average: '8.10',
      sale_price_total: '26000.00',
      sale_price_average: '13000.00',
      cost_basis_total: '23900.00',
      cost_basis_average: '11950.00',
      days_to_sell_average: '31.50',
    };
    const empty = { ...used, count: 0 };
    const report = {
      data: [
        {
          id: 'sale-1',
          sale_number: 'VS-2026-0001',
          vehicle_id: VEHICLE_A,
          make: 'VW',
          model: 'Passat',
          year: 2019,
          inventory_role: 'USED',
          invoice_date: '2026-10-05T00:00:00.000Z',
          sale_price: '13000.00',
          cost_basis_snapshot: '11950.00',
          gross_margin_eur: '1050.00',
          gross_margin_percent: '8.08',
          days_to_sell: 31,
          margin_taxed: true,
        },
      ],
      meta: {
        total: 2,
        page: 1,
        limit: 1,
        pageSize: 1,
        totalPages: 2,
        pageCount: 2,
      },
      totals: {
        count: 2,
        by_inventory_role: { USED: used, NEW: empty, DEMO: empty },
      },
    } as unknown as Awaited<ReturnType<VehicleStockReportsService['margin']>>;

    const margin = toMcpStockMarginReport(report, {
      ...scope,
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(margin.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(margin.totals).toEqual(used);
    expect(margin.data[0]).not.toHaveProperty('inventory_role');
    expect(margin.meta.next_cursor).not.toBeNull();
  });
});
