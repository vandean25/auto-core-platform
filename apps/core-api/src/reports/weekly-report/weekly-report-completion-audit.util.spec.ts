import { WorkshopOrderStatus } from '@prisma/client';
import { isWorkshopOrderStatusCompletionTransition } from './weekly-report-completion-audit.util.js';

describe('isWorkshopOrderStatusCompletionTransition', () => {
  it('accepts only a transition into COMPLETED', () => {
    expect(
      isWorkshopOrderStatusCompletionTransition({
        status: { before: 'IN_PROGRESS', after: WorkshopOrderStatus.COMPLETED },
      }),
    ).toBe(true);
  });

  it('rejects edits on an order that was already COMPLETED', () => {
    expect(
      isWorkshopOrderStatusCompletionTransition({
        status: {
          before: WorkshopOrderStatus.COMPLETED,
          after: WorkshopOrderStatus.COMPLETED,
        },
        notes: { before: 'a', after: 'b' },
      }),
    ).toBe(false);
    expect(
      isWorkshopOrderStatusCompletionTransition({
        notes: { before: 'a', after: 'b' },
      }),
    ).toBe(false);
  });
});
