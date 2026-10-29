import {
  EstimateApprovalDecision,
  WorkshopEstimateStatus,
} from '@prisma/client';
import { DOMAIN_EVENT_TYPES } from '../domain-event-store/domain-event.constants.js';
import {
  decideEstimateDecidedConsumerOutcome,
  parseEstimateDecidedPayload,
} from './workshop-estimate-decided-consumer.logic.js';

describe('workshop estimate decided consumer logic', () => {
  const baseContext = {
    eventId: 'event-1',
    tenantId: 'tenant-1',
    eventType: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
    payload: {
      estimate_version_id: 'version-1',
      decision: EstimateApprovalDecision.APPROVED,
    },
    version: {
      id: 'version-1',
      status: WorkshopEstimateStatus.APPROVED,
      estimate: {
        workshop_order_id: 'order-1',
        workshop_order: { site_id: 'site-1' },
      },
    },
    waitingCustomerTaskCount: 0,
    mechanicEmployeeIds: ['mechanic-1'],
  };

  it('parses a valid decided payload', () => {
    expect(
      parseEstimateDecidedPayload({
        estimate_version_id: 'version-1',
        decision: 'DECLINED',
      }),
    ).toEqual({
      estimate_version_id: 'version-1',
      decision: EstimateApprovalDecision.DECLINED,
    });
  });

  it('asks for push rows for the advisors of the site, and for the mechanics on approval only', () => {
    expect(decideEstimateDecidedConsumerOutcome(baseContext)).toMatchObject({
      kind: 'notify',
      push: {
        workshopOrderId: 'order-1',
        siteId: 'site-1',
        decision: 'APPROVED',
        extraEmployeeIds: ['mechanic-1'],
      },
    });

    const declined = decideEstimateDecidedConsumerOutcome({
      ...baseContext,
      payload: {
        estimate_version_id: 'version-1',
        decision: EstimateApprovalDecision.DECLINED,
      },
      version: {
        ...baseContext.version,
        status: WorkshopEstimateStatus.DECLINED,
      },
    });
    expect(declined).toMatchObject({
      kind: 'notify',
      push: { decision: 'DECLINED', extraEmployeeIds: [] },
    });
  });

  it('creates an internal notice with order and version ids', () => {
    const outcome = decideEstimateDecidedConsumerOutcome(baseContext);
    expect(outcome).toMatchObject({
      kind: 'notify',
      reason: 'CUSTOMER_ESTIMATE_APPROVED',
      input: {
        occurrenceId: 'event-1',
        workshopOrderId: 'order-1',
        sourceEntityId: 'version-1',
        payload: {
          decision: 'APPROVED',
          estimate_version_id: 'version-1',
          workshop_order_id: 'order-1',
          needs_human_review: false,
        },
      },
    });
  });

  it('flags human review when waiting-customer tasks exist', () => {
    const outcome = decideEstimateDecidedConsumerOutcome({
      ...baseContext,
      waitingCustomerTaskCount: 2,
    });
    expect(outcome).toMatchObject({
      kind: 'notify',
      reason: 'CUSTOMER_ESTIMATE_APPROVED_REVIEW_WAITING_TASKS',
      input: {
        payload: { needs_human_review: true },
      },
    });
  });

  it('skips superseded versions so no misleading open case is created', () => {
    const outcome = decideEstimateDecidedConsumerOutcome({
      ...baseContext,
      version: {
        ...baseContext.version,
        status: WorkshopEstimateStatus.SUPERSEDED,
      },
    });
    expect(outcome).toEqual({ kind: 'skip', reason: 'VERSION_NOT_ACTIONABLE' });
  });
});
