import type { PrismaService } from '../prisma/prisma.service.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import { effectiveEstimateStatus } from './workshop-estimate-version-expiry.js';
import type {
  ListSiteEstimateVersionsPageRequest,
  SiteEstimateVersionListRow,
} from './workshop-estimate-version-site-list.read.types.js';
import {
  buildSiteEstimateVersionsPageWhere,
  decodeEstimateKeysetCursor,
  encodeEstimateKeysetCursor,
} from './workshop-estimate-version-site-list.read.support.js';

export async function querySiteEstimateVersionsPage(
  prisma: PrismaService,
  scope: EstimateScope,
  request: ListSiteEstimateVersionsPageRequest,
  now: Date = new Date(),
): Promise<{ rows: SiteEstimateVersionListRow[]; nextCursor: string | null }> {
  const decodedCursor =
    request.cursor === undefined
      ? undefined
      : decodeEstimateKeysetCursor(request.cursor);

  const where = buildSiteEstimateVersionsPageWhere(
    scope,
    request,
    decodedCursor ?? undefined,
    now,
  );

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
