import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  decodeDomainEventFeedCursor,
  encodeDomainEventFeedCursor,
  sequenceFromCursor,
} from './domain-event.cursor.js';
import { toDomainEventEnvelope } from './domain-event-feed.mapper.js';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;

const FEED_ORDER: Prisma.DomainEventOrderByWithRelationInput[] = [
  { sequence: 'asc' },
  { id: 'asc' },
];

export type ListDomainEventsQuery = {
  cursor?: string;
  pageSize?: number;
  eventType?: string;
};

export type DomainEventFeedPage = {
  data: ReturnType<typeof toDomainEventEnvelope>[];
  meta: { next_cursor: string | null };
};

@Injectable()
export class DomainEventFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async listFeed(query: ListDomainEventsQuery): Promise<DomainEventFeedPage> {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    if (authorizedSiteIds.length === 0) {
      return { data: [], meta: { next_cursor: null } };
    }

    const pageSize = clampPageSize(query.pageSize);
    const cursor = await this.resolveCursor(
      tenantId,
      authorizedSiteIds,
      query.cursor,
    );
    const where = this.buildWhere(
      tenantId,
      authorizedSiteIds,
      cursor,
      query.eventType,
    );

    const rows = await this.prisma.domainEvent.findMany({
      where,
      orderBy: FEED_ORDER,
      take: pageSize + 1,
    });

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page.at(-1);
    return {
      data: page.map(toDomainEventEnvelope),
      meta: {
        next_cursor:
          hasMore && last
            ? encodeDomainEventFeedCursor({
                sequence: last.sequence,
                id: last.id,
              })
            : null,
      },
    };
  }

  private async resolveCursor(
    tenantId: string,
    authorizedSiteIds: string[],
    raw?: string,
  ): Promise<{ sequence: bigint; id: string } | null> {
    if (!raw) {
      return null;
    }
    const decoded = decodeDomainEventFeedCursor(raw);
    if (!decoded) {
      throw new BadRequestException('cursor is invalid');
    }
    const anchor = await this.prisma.domainEvent.findFirst({
      where: {
        tenant_id: tenantId,
        id: decoded.id,
        sequence: sequenceFromCursor(decoded),
        site_id: { in: authorizedSiteIds },
      },
      select: { id: true, sequence: true },
    });
    if (!anchor) {
      throw new BadRequestException('cursor is invalid');
    }
    return { sequence: anchor.sequence, id: anchor.id };
  }

  private buildWhere(
    tenantId: string,
    authorizedSiteIds: string[],
    cursor: { sequence: bigint; id: string } | null,
    eventType?: string,
  ): Prisma.DomainEventWhereInput {
    const siteFilter: Prisma.DomainEventWhereInput = {
      tenant_id: tenantId,
      site_id: { in: authorizedSiteIds },
      ...(eventType ? { event_type: eventType } : {}),
    };
    if (!cursor) {
      return siteFilter;
    }
    return {
      AND: [
        siteFilter,
        {
          OR: [
            { sequence: { gt: cursor.sequence } },
            { sequence: cursor.sequence, id: { gt: cursor.id } },
          ],
        },
      ],
    };
  }
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || !Number.isFinite(pageSize) || pageSize < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE);
}
