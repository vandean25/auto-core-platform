import { LeaveRequestStatus, WorkshopOrderStatus } from '@prisma/client';
import {
  plannerBayFilter,
  plannerLeaveFilter,
  plannerOrderFilter,
} from './workshop-planner.queries.js';

const range = {
  from: new Date('2026-08-24T00:00:00.000Z'),
  to: new Date('2026-08-26T22:00:00.000Z'),
};

describe('workshop-planner.queries', () => {
  describe('plannerBayFilter', () => {
    it('selects active bays', () => {
      expect(plannerBayFilter()).toEqual({ is_active: true });
    });

    it('narrows to one bay when a bay id is given', () => {
      expect(plannerBayFilter('bay-2')).toEqual({
        is_active: true,
        id: 'bay-2',
      });
    });
  });

  describe('plannerOrderFilter', () => {
    it('selects active orders scheduled into the range or unscheduled on the floor', () => {
      expect(plannerOrderFilter(range)).toEqual({
        status: {
          in: [
            WorkshopOrderStatus.SCHEDULED,
            WorkshopOrderStatus.INTAKE,
            WorkshopOrderStatus.IN_PROGRESS,
          ],
        },
        bay_id: { not: null },
        OR: [
          {
            scheduled_start_at: { lt: range.to },
            scheduled_end_at: { gt: range.from },
          },
          {
            scheduled_start_at: null,
            scheduled_end_at: null,
            status: {
              in: [WorkshopOrderStatus.INTAKE, WorkshopOrderStatus.IN_PROGRESS],
            },
          },
        ],
      });
    });

    it('narrows to one bay when a bay id is given', () => {
      expect(plannerOrderFilter(range, 'bay-2')).toEqual(
        expect.objectContaining({ bay_id: 'bay-2' }),
      );
    });
  });

  describe('plannerLeaveFilter', () => {
    it('selects only booked leave that overlaps the local-day bounds', () => {
      const bounds = {
        fromLocalDate: new Date('2026-08-24T00:00:00.000Z'),
        toLocalDate: new Date('2026-08-26T00:00:00.000Z'),
      };

      expect(plannerLeaveFilter(bounds)).toEqual({
        status: LeaveRequestStatus.BOOKED,
        start_on: { lte: bounds.toLocalDate },
        end_on: { gte: bounds.fromLocalDate },
      });
    });
  });
});
