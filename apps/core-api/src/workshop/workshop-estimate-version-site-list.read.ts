import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { localDateStartUtc } from './workshop-kpi-reports.math.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import { effectiveEstimateStatus } from './workshop-estimate-version-expiry.js';

function nextIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function siteLocalSentRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { gte: Date; lt: Date } | null {
  if (!from || !to) {
    return null;
  }
  return {
    gte: localDateStartUtc(from, timeZone),
    lt: localDateStartUtc(nextIsoDate(to), timeZone),
  };
}

export type SiteEstimateVersionListRow = {
  id: string;
  version: number;
  status: WorkshopEstimateStatus;
  valid_until: Date | null;
  sent_at: Date | null;
  decided_at: Date | null;
  channel: string | null;
  total_net: Prisma.Decimal | null;
  total_gross: Prisma.Decimal | null;
  estimate: {
    estimate_number: string;
    workshop_order_id: string;
    site_id: string;
    workshop_order: {
      customer_id: string | null;
      order_number: string;
    };
  };
};

export type ListSiteEstimateVersionsFilters = {
  customerId?: string;
  orderId?: string;
  status?: WorkshopEstimateStatus;
  sentFrom?: string;
  sentTo?: string;
  timeZone: string;
};

export async function listSiteEstimateVersions(
  prisma: PrismaService,
  scope: EstimateScope,
  filters: ListSiteEstimateVersionsFilters,
  now: Date = new Date(),
): Promise<SiteEstimateVersionListRow[]> {
  const sentRange = siteLocalSentRange(
    filters.sentFrom,
    filters.sentTo,
    filters.timeZone,
  );

  const rows = await prisma.workshopEstimateVersion.findMany({
    where: {
      tenant_id: scope.tenantId,
      estimate: {
        site_id: scope.siteId,
        ...(filters.orderId
          ? { workshop_order_id: filters.orderId }
          : {}),
        workshop_order: filters.customerId
          ? { customer_id: filters.customerId }
          : undefined,
      },
      ...(sentRange
        ? {
            sent_at: {
              gte: sentRange.gte,
              lt: sentRange.lt,
            },
          }
        : {}),
    },
    orderBy: [{ sent_at: 'desc' }, { id: 'desc' }],
    take: 500,
    select: {
      id: true,
      version: true,
      status: true,
      sent_at: true,
      valid_until: true,
      total_net: true,
      total_gross: true,
      approvals: {
        orderBy: [{ decided_at: 'desc' }],
        take: 1,
        select: {
          decided_at: true,
          channel: true,
        },
      },
      estimate: {
        select: {
          estimate_number: true,
          workshop_order_id: true,
          site_id: true,
          workshop_order: {
            select: {
              customer_id: true,
              order_number: true,
            },
          },
        },
      },
    },
  });

  const mapped: SiteEstimateVersionListRow[] = rows.map((row) => ({
    id: row.id,
    version: row.version,
    valid_until: row.valid_until,
    status: effectiveEstimateStatus(row, now),
    sent_at: row.sent_at,
    decided_at: row.approvals[0]?.decided_at ?? null,
    channel: row.approvals[0]?.channel ?? null,
    total_net: row.total_net,
    total_gross: row.total_gross,
    estimate: row.estimate,
  }));

  if (!filters.status) {
    return mapped;
  }

  return mapped.filter(
    (row) =>
      effectiveEstimateStatus(row, now) === filters.status,
  );
}
