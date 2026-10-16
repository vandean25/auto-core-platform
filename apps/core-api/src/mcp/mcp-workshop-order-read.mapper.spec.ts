import { WorkshopEstimateStatus } from '@prisma/client';
import {
  effectiveEstimateStatus,
  isInstantInSiteLocalDateRange,
  nextIsoDate,
  siteLocalInclusiveDateRange,
  toMcpEstimateSummary,
} from './mcp-workshop-order-read.mapper.js';

describe('mcp-workshop-order-read.mapper', () => {
  it('builds an exclusive UTC end from inclusive site-local dates', () => {
    const range = siteLocalInclusiveDateRange(
      '2026-10-16',
      '2026-10-16',
      'Europe/Vienna',
    );
    expect(range).not.toBeNull();
    expect(nextIsoDate('2026-10-16')).toBe('2026-10-17');
    const sentAt = new Date('2026-10-16T10:00:00.000Z');
    expect(isInstantInSiteLocalDateRange(sentAt, range!)).toBe(true);
  });

  it('reports SENT past valid_until as EXPIRED', () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    expect(
      effectiveEstimateStatus(
        {
          status: WorkshopEstimateStatus.SENT,
          valid_until: new Date('2026-10-19T23:59:59.000Z'),
        },
        now,
      ),
    ).toBe(WorkshopEstimateStatus.EXPIRED);
    expect(
      toMcpEstimateSummary(
        {
          id: 'v1',
          version: 2,
          status: WorkshopEstimateStatus.SENT,
          sent_at: new Date('2026-10-16T08:00:00.000Z'),
          valid_until: new Date('2026-10-19T23:59:59.000Z'),
          total_gross: null,
          estimate: {
            estimate_number: 'KV-2026-0001',
            workshop_order_id: 'order-1',
          },
        },
        now,
      ).status,
    ).toBe(WorkshopEstimateStatus.EXPIRED);
  });
});
