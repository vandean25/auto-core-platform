import type { Prisma } from '@prisma/client';

export type RevenueReportSource = 'workshop' | 'vehicle_sales' | 'other';

export type RevenueReportAmounts = {
  net: Prisma.Decimal;
  vat: Prisma.Decimal;
  gross: Prisma.Decimal;
};

export type RevenueReportPeriod = {
  from: string;
  to: string;
  timezone: string;
};

export type RevenueReportCore = {
  period: RevenueReportPeriod;
  site_id: string | null;
  totals: RevenueReportAmounts;
  by_source: Array<RevenueReportAmounts & { source: RevenueReportSource }>;
  by_revenue_group: Array<RevenueReportAmounts & { name: string }>;
  invoice_count: number;
};

export type RevenueReportResult = RevenueReportCore & {
  previous?: RevenueReportCore;
};
