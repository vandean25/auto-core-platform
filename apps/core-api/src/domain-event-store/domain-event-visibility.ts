import type { Prisma, VisibleDomainEvent } from '@prisma/client';

export type DomainEventReaderClient = {
  visibleDomainEvent: {
    findMany(
      args: Prisma.VisibleDomainEventFindManyArgs,
    ): Promise<VisibleDomainEvent[]>;
  };
};

export type VisibleDomainEventsQuery = {
  tenantId: string;
  siteIds?: readonly string[];
  eventType?: string;
  afterSequence?: bigint;
  afterCursor?: { sequence: bigint; id: string };
  limit: number;
};

/**
 * Queries `visible_domain_events` (`tx_xid < pg_snapshot_xmin(pg_current_snapshot())`)
 * so readers never observe or advance cursors past uncommitted out-of-order transactions (AUT-1052).
 */
export async function queryVisibleDomainEvents(
  prisma: DomainEventReaderClient,
  query: VisibleDomainEventsQuery,
): Promise<VisibleDomainEvent[]> {
  if (query.siteIds && query.siteIds.length === 0) {
    return [];
  }

  const baseWhere: Prisma.VisibleDomainEventWhereInput = {
    tenant_id: query.tenantId,
    ...(query.siteIds ? { site_id: { in: [...query.siteIds] } } : {}),
    ...(query.eventType ? { event_type: query.eventType } : {}),
  };

  let where: Prisma.VisibleDomainEventWhereInput = baseWhere;
  if (query.afterCursor) {
    const cursor = query.afterCursor;
    where = {
      AND: [
        baseWhere,
        {
          OR: [
            { sequence: { gt: cursor.sequence } },
            { sequence: cursor.sequence, id: { gt: cursor.id } },
          ],
        },
      ],
    };
  } else if (query.afterSequence !== undefined) {
    where = {
      ...baseWhere,
      sequence: { gt: query.afterSequence },
    };
  }

  return prisma.visibleDomainEvent.findMany({
    where,
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.floor(query.limit)),
  });
}
