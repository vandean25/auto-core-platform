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

export type ListSiteEstimateVersionsPageRequest =
  ListSiteEstimateVersionsFilters & {
    pageSize: number;
    cursor?: string;
  };

export type ListSiteEstimateVersionsPage = {
  rows: SiteEstimateVersionListRow[];
  nextCursor: string | null;
};

type EstimateKeysetCursor = {
  sent_at: string | null;
  id: string;
};

function encodeEstimateKeysetCursor(row: {
  sent_at: Date | null;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      sent_at: row.sent_at ? row.sent_at.toISOString() : null,
      id: row.id,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeEstimateKeysetCursor(
  cursor: string,
): EstimateKeysetCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as EstimateKeysetCursor;
    if (typeof parsed.id !== 'string') {
      return null;
    }
    if (parsed.sent_at !== null && typeof parsed.sent_at !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function effectiveStatusWhere(
  status: WorkshopEstimateStatus,
  now: Date,
): Prisma.WorkshopEstimateVersionWhereInput {
  if (status === WorkshopEstimateStatus.EXPIRED) {
    return {
      OR: [
        { status: WorkshopEstimateStatus.EXPIRED },
        {
          status: WorkshopEstimateStatus.SENT,
          valid_until: { lt: now },
        },
      ],
    };
  }
  if (status === WorkshopEstimateStatus.SENT) {
    return {
      status: WorkshopEstimateStatus.SENT,
      OR: [{ valid_until: null }, { valid_until: { gte: now } }],
    };
  }
  return { status };
}

function keysetAfterCursor(
  cursor: EstimateKeysetCursor,
): Prisma.WorkshopEstimateVersionWhereInput {
  const sentAt = cursor.sent_at === null ? null : new Date(cursor.sent_at);
  if (sentAt === null) {
    return {
      OR: [{ sent_at: null, id: { lt: cursor.id } }],
    };
  }
  return {
    OR: [
      { sent_at: { lt: sentAt } },
      { sent_at: sentAt, id: { lt: cursor.id } },
      { sent_at: null },
    ],
  };
}

export async function listSiteEstimateVersionsPage(
  prisma: PrismaService,
  scope: EstimateScope,
  request: ListSiteEstimateVersionsPageRequest,
  now: Date = new Date(),
): Promise<ListSiteEstimateVersionsPage> {
  const sentRange = siteLocalSentRange(
    request.sentFrom,
    request.sentTo,
    request.timeZone,
  );
  const decodedCursor =
    request.cursor === undefined
      ? undefined
      : decodeEstimateKeysetCursor(request.cursor);

  const where: Prisma.WorkshopEstimateVersionWhereInput = {
    tenant_id: scope.tenantId,
    estimate: {
      site_id: scope.siteId,
      ...(request.orderId ? { workshop_order_id: request.orderId } : {}),
      workshop_order: request.customerId
        ? { customer_id: request.customerId }
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
    ...(request.status
      ? effectiveStatusWhere(request.status, now)
      : {}),
    ...(decodedCursor ? keysetAfterCursor(decodedCursor) : {}),
  };

  const take = request.pageSize + 1;
  const rows = await prisma.workshopEstimateVersion.findMany({
    where,
    orderBy: [{ sent_at: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take,
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

  const hasMore = rows.length > request.pageSize;
  const pageRows = hasMore ? rows.slice(0, request.pageSize) : rows;
  const mapped: SiteEstimateVersionListRow[] = pageRows.map((row) => ({
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

  const last = pageRows[pageRows.length - 1];
  return {
    rows: mapped,
    nextCursor:
      hasMore && last
        ? encodeEstimateKeysetCursor({ sent_at: last.sent_at, id: last.id })
        : null,
  };
}

/** @deprecated Use {@link listSiteEstimateVersionsPage} for MCP paging. */
export async function listSiteEstimateVersions(
  prisma: PrismaService,
  scope: EstimateScope,
  filters: ListSiteEstimateVersionsFilters,
  now: Date = new Date(),
): Promise<SiteEstimateVersionListRow[]> {
  const page = await listSiteEstimateVersionsPage(
    prisma,
    scope,
    { ...filters, pageSize: 500 },
    now,
  );
  return page.rows;
}
