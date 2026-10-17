import {
  WorkshopEstimateStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import { WorkshopEstimateDecisionTriageService } from './workshop-estimate-decision-triage.service.js';

const TENANT = 'tenant-1';
const SITE = 'site-1';
const ORDER = 'order-1';
const VERSION = 'version-1';
const NOTICE = 'notice-1';
const CREATED = new Date('2026-06-01T10:00:00.000Z');

function buildOutboxRow(
  overrides: {
    payload?: Record<string, unknown>;
    orderId?: string;
  } = {},
) {
  const orderId = overrides.orderId ?? ORDER;
  return {
    id: NOTICE,
    createdAt: CREATED,
    payload: {
      decision: 'APPROVED',
      estimate_version_id: VERSION,
      workshop_order_id: orderId,
      needs_human_review: true,
      ...overrides.payload,
    },
    workshop_order_id: orderId,
    workshop_order: { site_id: SITE },
    source_entity_id: VERSION,
  };
}

function buildService(mocks: {
  outboxRows: ReturnType<typeof buildOutboxRow>[];
  versionStatus?: WorkshopEstimateStatus;
  orderStatus?: WorkshopOrderStatus;
  waitingCustomerCount?: number;
}) {
  const prisma = {
    notificationOutbox: {
      findMany: jest.fn().mockResolvedValue(mocks.outboxRows),
    },
    workshopEstimateVersion: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: VERSION,
          status: mocks.versionStatus ?? WorkshopEstimateStatus.APPROVED,
        },
      ]),
    },
    workshopOrder: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: ORDER,
          status: mocks.orderStatus ?? WorkshopOrderStatus.IN_PROGRESS,
        },
      ]),
    },
    workshopTask: {
      groupBy: jest.fn().mockResolvedValue(
        (mocks.waitingCustomerCount ?? 0) > 0
          ? [
              {
                workshop_order_id: ORDER,
                _count: { _all: mocks.waitingCustomerCount },
              },
            ]
          : [],
      ),
    },
  };
  return {
    service: new WorkshopEstimateDecisionTriageService(prisma as never),
    prisma,
  };
}

describe('WorkshopEstimateDecisionTriageService', () => {
  it('returns no candidates when no sites are authorized', async () => {
    const { service, prisma } = buildService({ outboxRows: [buildOutboxRow()] });
    await expect(
      service.listCustomerDecisionTriageCandidates(TENANT, []),
    ).resolves.toEqual([]);
    expect(prisma.notificationOutbox.findMany).not.toHaveBeenCalled();
  });

  it('omits cases when the workshop order is invoiced', async () => {
    const { service } = buildService({
      outboxRows: [buildOutboxRow()],
      orderStatus: WorkshopOrderStatus.INVOICED,
    });
    await expect(
      service.listCustomerDecisionTriageCandidates(TENANT, [SITE]),
    ).resolves.toEqual([]);
  });

  it('omits cases when the workshop order is completed', async () => {
    const { service } = buildService({
      outboxRows: [buildOutboxRow()],
      orderStatus: WorkshopOrderStatus.COMPLETED,
    });
    await expect(
      service.listCustomerDecisionTriageCandidates(TENANT, [SITE]),
    ).resolves.toEqual([]);
  });

  it('includes an open order with a decided estimate', async () => {
    const { service } = buildService({
      outboxRows: [buildOutboxRow({ payload: { needs_human_review: false } })],
      waitingCustomerCount: 0,
    });
    const items = await service.listCustomerDecisionTriageCandidates(TENANT, [
      SITE,
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'CUSTOMER_DECISION',
        entity_id: NOTICE,
        reason: 'CUSTOMER_ESTIMATE_APPROVED',
      }),
    ]);
  });

  it('clears the review-waiting reason when no tasks are waiting on the customer', async () => {
    const { service } = buildService({
      outboxRows: [buildOutboxRow()],
      waitingCustomerCount: 0,
    });
    const items = await service.listCustomerDecisionTriageCandidates(TENANT, [
      SITE,
    ]);
    expect(items[0]?.reason).toBe('CUSTOMER_ESTIMATE_APPROVED');
  });

  it('keeps the review-waiting reason while customer-waiting tasks remain', async () => {
    const { service } = buildService({
      outboxRows: [buildOutboxRow()],
      waitingCustomerCount: 2,
    });
    const items = await service.listCustomerDecisionTriageCandidates(TENANT, [
      SITE,
    ]);
    expect(items[0]?.reason).toBe(
      'CUSTOMER_ESTIMATE_APPROVED_REVIEW_WAITING_TASKS',
    );
  });
});
