import { BadRequestException } from '@nestjs/common';
import { DomainEventFeedService } from './domain-event-feed.service.js';
import { encodeDomainEventFeedCursor } from './domain-event.cursor.js';

function makeRow(sequence: bigint, id: string, siteId = 'site-1') {
  return {
    id,
    sequence,
    event_type: 'workshop_order.scheduled.v1',
    schema_version: 1,
    tenant_id: 'tenant-1',
    site_id: siteId,
    entity_id: 'order-1',
    occurred_at: new Date('2026-10-15T08:00:00.000Z'),
    trace_id: '00000000-0000-4000-8000-000000000001',
    occurrence_key: `workshop_order.scheduled.v1:order-1`,
    payload: {},
  };
}

describe('DomainEventFeedService.listFeed', () => {
  const tenantContext = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
  const siteContext = {
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
  };

  it('returns an empty page when the caller has no authorized sites', async () => {
    siteContext.listAuthorizedSiteIds.mockResolvedValueOnce([]);
    const prisma = { domainEvent: { findMany: jest.fn() } };
    const service = new DomainEventFeedService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
    );

    const page = await service.listFeed({});
    expect(page).toEqual({ data: [], meta: { next_cursor: null } });
    expect(prisma.domainEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects a cursor that does not anchor in the tenant', async () => {
    const prisma = {
      domainEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      },
    };
    const service = new DomainEventFeedService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
    );
    const foreignCursor = encodeDomainEventFeedCursor({
      sequence: BigInt(99),
      id: '00000000-0000-4000-8000-000000000099',
    });

    await expect(service.listFeed({ cursor: foreignCursor })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.domainEvent.findMany).not.toHaveBeenCalled();
  });

  it('pages forward by sequence and returns a resumable cursor', async () => {
    const rows = [
      makeRow(BigInt(1), '00000000-0000-4000-8000-000000000001'),
      makeRow(BigInt(2), '00000000-0000-4000-8000-000000000002'),
    ];
    const prisma = {
      domainEvent: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const service = new DomainEventFeedService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
    );

    const page = await service.listFeed({ pageSize: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0].event_id).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(page.meta.next_cursor).toBeTruthy();
  });
});
