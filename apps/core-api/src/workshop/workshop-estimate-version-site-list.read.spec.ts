import { WorkshopEstimateStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { effectiveEstimateStatus } from './workshop-estimate-version-expiry.js';
import { listSiteEstimateVersionsPage } from './workshop-estimate-version-site-list.read.js';
import { buildSiteEstimateVersionsPageWhere } from './workshop-estimate-version-site-list.read.support.js';
import {
  createEstimateVersionListPrisma,
  type EstimateVersionFixture,
} from './workshop-estimate-version-site-list.read.spec.support.js';

const SCOPE = { tenantId: 'tenant-1', siteId: 'site-1' };
const NOW = new Date('2026-10-15T12:00:00.000Z');

function estimateRow(
  id: string,
  status: WorkshopEstimateStatus,
  sentAt: Date | null,
  validUntil: Date | null = null,
  customerId: string | null = '00000000-0000-4000-8000-000000000002',
): EstimateVersionFixture {
  return {
    id,
    version: 1,
    status,
    sent_at: sentAt,
    valid_until: validUntil,
    total_net: null,
    total_gross: null,
    approvals: [],
    estimate: {
      estimate_number: 'EST-1',
      workshop_order_id: '00000000-0000-4000-8000-000000000001',
      site_id: SCOPE.siteId,
      workshop_order: {
        customer_id: customerId,
        order_number: 'WO-1',
      },
    },
  };
}

describe('buildSiteEstimateVersionsPageWhere', () => {
  it('ANDs status filter with keyset cursor predicates', () => {
    const where = buildSiteEstimateVersionsPageWhere(
      SCOPE,
      {
        timeZone: 'Europe/Vienna',
        status: WorkshopEstimateStatus.SENT,
        pageSize: 2,
        cursor: Buffer.from(
          JSON.stringify({
            sent_at: '2026-10-18T10:00:00.000Z',
            id: '00000000-0000-4000-8000-000000000099',
          }),
          'utf8',
        ).toString('base64url'),
      },
      {
        sent_at: '2026-10-18T10:00:00.000Z',
        id: '00000000-0000-4000-8000-000000000099',
      },
      NOW,
    );
    expect(where.AND).toHaveLength(3);
    const statusClause = where.AND?.[1];
    expect(statusClause).toMatchObject({ status: WorkshopEstimateStatus.SENT });
    expect(statusClause?.OR).toBeDefined();
    expect(where.AND?.[2]?.OR).toBeDefined();
  });
});

describe('listSiteEstimateVersionsPage', () => {
  it('keeps SENT status filter on page 2 (excludes effectively EXPIRED rows)', async () => {
    const rows = [
      estimateRow(
        '00000000-0000-4000-8000-000000000010',
        WorkshopEstimateStatus.SENT,
        new Date('2026-10-20T10:00:00.000Z'),
      ),
      estimateRow(
        '00000000-0000-4000-8000-000000000011',
        WorkshopEstimateStatus.SENT,
        new Date('2026-10-19T10:00:00.000Z'),
      ),
      estimateRow(
        '00000000-0000-4000-8000-000000000012',
        WorkshopEstimateStatus.SENT,
        new Date('2026-10-18T10:00:00.000Z'),
      ),
      estimateRow(
        '00000000-0000-4000-8000-000000000013',
        WorkshopEstimateStatus.SENT,
        new Date('2026-10-17T10:00:00.000Z'),
        new Date('2026-10-10T00:00:00.000Z'),
      ),
      estimateRow(
        '00000000-0000-4000-8000-000000000014',
        WorkshopEstimateStatus.DRAFT,
        null,
      ),
    ];
    const prisma = createEstimateVersionListPrisma(
      rows,
      SCOPE,
      NOW,
    ) as unknown as PrismaService;

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
    expect(first.rows.map((row) => row.id)).toEqual([
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
    ]);

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

    const secondIds = second.rows.map((row) => row.id);
    expect(secondIds).toEqual(['00000000-0000-4000-8000-000000000012']);
    expect(secondIds.some((id) => first.rows.some((row) => row.id === id))).toBe(
      false,
    );
    expect(
      second.rows.every(
        (row) => effectiveEstimateStatus(row, NOW) === WorkshopEstimateStatus.SENT,
      ),
    ).toBe(true);
  });

  it('keeps EXPIRED status filter on page 2', async () => {
    const rows = [
      estimateRow(
        '00000000-0000-4000-8000-000000000020',
        WorkshopEstimateStatus.EXPIRED,
        new Date('2026-10-20T10:00:00.000Z'),
      ),
      estimateRow(
        '00000000-0000-4000-8000-000000000021',
        WorkshopEstimateStatus.SENT,
        new Date('2026-10-19T10:00:00.000Z'),
        new Date('2026-10-01T00:00:00.000Z'),
      ),
      estimateRow(
        '00000000-0000-4000-8000-000000000022',
        WorkshopEstimateStatus.SENT,
        new Date('2026-10-18T10:00:00.000Z'),
      ),
      estimateRow(
        '00000000-0000-4000-8000-000000000023',
        WorkshopEstimateStatus.DRAFT,
        null,
      ),
    ];
    const prisma = createEstimateVersionListPrisma(
      rows,
      SCOPE,
      NOW,
    ) as unknown as PrismaService;

    const first = await listSiteEstimateVersionsPage(
      prisma,
      SCOPE,
      {
        timeZone: 'Europe/Vienna',
        status: WorkshopEstimateStatus.EXPIRED,
        pageSize: 1,
      },
      NOW,
    );

    expect(first.rows.map((row) => row.id)).toEqual([
      '00000000-0000-4000-8000-000000000020',
    ]);

    const second = await listSiteEstimateVersionsPage(
      prisma,
      SCOPE,
      {
        timeZone: 'Europe/Vienna',
        status: WorkshopEstimateStatus.EXPIRED,
        pageSize: 1,
        cursor: first.nextCursor ?? undefined,
      },
      NOW,
    );

    const secondIds = second.rows.map((row) => row.id);
    expect(secondIds).toEqual(['00000000-0000-4000-8000-000000000021']);
    expect(secondIds.some((id) => first.rows.some((row) => row.id === id))).toBe(
      false,
    );
    expect(
      [...first.rows, ...second.rows].every(
        (row) =>
          effectiveEstimateStatus(row, NOW) === WorkshopEstimateStatus.EXPIRED,
      ),
    ).toBe(true);
  });

  it('returns a row when the workshop order has no customer', async () => {
    const rows = [
      estimateRow(
        '00000000-0000-4000-8000-000000000030',
        WorkshopEstimateStatus.SENT,
        new Date('2026-10-20T10:00:00.000Z'),
        null,
        null,
      ),
    ];
    const prisma = createEstimateVersionListPrisma(
      rows,
      SCOPE,
      NOW,
    ) as unknown as PrismaService;

    const page = await listSiteEstimateVersionsPage(
      prisma,
      SCOPE,
      {
        timeZone: 'Europe/Vienna',
        status: WorkshopEstimateStatus.SENT,
        pageSize: 10,
      },
      NOW,
    );

    expect(page.rows[0].estimate.workshop_order.customer_id).toBeNull();
  });
});
