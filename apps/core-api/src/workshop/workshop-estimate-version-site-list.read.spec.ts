import { WorkshopEstimateStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { listSiteEstimateVersionsPage } from './workshop-estimate-version-site-list.read.js';

const SCOPE = { tenantId: 'tenant-1', siteId: 'site-1' };
const NOW = new Date('2026-10-15T12:00:00.000Z');

function estimateRow(
  id: string,
  status: WorkshopEstimateStatus,
  sentAt: Date | null,
) {
  return {
    id,
    version: 1,
    status,
    sent_at: sentAt,
    valid_until: null,
    total_net: null,
    total_gross: null,
    approvals: [],
    estimate: {
      estimate_number: 'EST-1',
      workshop_order_id: '00000000-0000-4000-8000-000000000001',
      site_id: SCOPE.siteId,
      workshop_order: {
        customer_id: '00000000-0000-4000-8000-000000000002',
        order_number: 'WO-1',
      },
    },
  };
}

describe('listSiteEstimateVersionsPage', () => {
  it('pages SENT versions in the database without a draft cap swallowing results', async () => {
    const sentRows = Array.from({ length: 6 }, (_, index) =>
      estimateRow(
        `00000000-0000-4000-8000-0000000000${String(index + 10).padStart(2, '0')}`,
        WorkshopEstimateStatus.SENT,
        new Date(`2026-10-${20 - index}T10:00:00.000Z`),
      ),
    );
    const findMany = jest.fn(async (args: { take: number; where: unknown }) => {
      expect(args.take).toBe(3);
      const where = JSON.stringify(args.where);
      expect(where).toContain('"status":"SENT"');
      if (where.includes('sent_at')) {
        return sentRows.slice(2, 2 + args.take);
      }
      return sentRows.slice(0, args.take);
    });
    const prisma = {
      workshopEstimateVersion: { findMany },
    } as unknown as PrismaService;

    const first = await listSiteEstimateVersionsPage(
      prisma,
      SCOPE,
      {
        timeZone: 'Europe/Vienna',
        status: WorkshopEstimateStatus.SENT,
        pageSize: 2,
      },
      NOW,
    );

    expect(first.rows).toHaveLength(2);
    expect(first.rows.every((row) => row.status === WorkshopEstimateStatus.SENT))
      .toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const second = await listSiteEstimateVersionsPage(
      prisma,
      SCOPE,
      {
        timeZone: 'Europe/Vienna',
        status: WorkshopEstimateStatus.SENT,
        pageSize: 2,
        cursor: first.nextCursor ?? undefined,
      },
      NOW,
    );

    expect(second.rows).toHaveLength(2);
    expect(second.nextCursor).toBeTruthy();
  });
});
