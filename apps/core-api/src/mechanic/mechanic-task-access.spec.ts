import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkshopTaskStatus } from '@prisma/client';
import {
  assertTaskAccessible,
  assertTaskAccessibleAndNotDone,
  assertTaskAssignedToMechanic,
  assertTaskNotDone,
} from './mechanic-task-access';

describe('mechanic-task-access', () => {
  const mechanicId = 'tech-1';
  const otherMechanicId = 'tech-2';

  describe('assertTaskAssignedToMechanic', () => {
    it('allows task directly assigned to mechanic', () => {
      expect(() =>
        assertTaskAssignedToMechanic(
          {
            id: 'task-1',
            mechanic_id: mechanicId,
            bay_id: null,
            workshop_order: { mechanic_id: null, bay_id: null },
          },
          mechanicId,
        ),
      ).not.toThrow();
    });

    it('allows task inheriting mechanic from workshop order', () => {
      expect(() =>
        assertTaskAssignedToMechanic(
          {
            id: 'task-1',
            mechanic_id: null,
            bay_id: null,
            workshop_order: { mechanic_id: mechanicId, bay_id: null },
          },
          mechanicId,
        ),
      ).not.toThrow();
    });

    it('throws ForbiddenException when assigned to another mechanic', () => {
      expect(() =>
        assertTaskAssignedToMechanic(
          {
            id: 'task-1',
            mechanic_id: otherMechanicId,
            bay_id: null,
            workshop_order: { mechanic_id: mechanicId, bay_id: null },
          },
          mechanicId,
        ),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when unassigned on both task and order', () => {
      expect(() =>
        assertTaskAssignedToMechanic(
          {
            id: 'task-1',
            mechanic_id: null,
            bay_id: null,
            workshop_order: { mechanic_id: null, bay_id: null },
          },
          mechanicId,
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('assertTaskAccessible', () => {
    it('throws NotFoundException when task is null', () => {
      expect(() => assertTaskAccessible(null, 'task-1', mechanicId)).toThrow(
        NotFoundException,
      );
    });

    it('asserts assignment when task exists', () => {
      const task = {
        id: 'task-1',
        mechanic_id: mechanicId,
        bay_id: null,
        workshop_order: { mechanic_id: null, bay_id: null },
      };
      expect(() =>
        assertTaskAccessible(task, 'task-1', mechanicId),
      ).not.toThrow();
    });
  });

  describe('assertTaskNotDone', () => {
    it('throws UnprocessableEntityException when status is DONE', () => {
      expect(() =>
        assertTaskNotDone('task-1', WorkshopTaskStatus.DONE),
      ).toThrow(UnprocessableEntityException);
    });

    it('uses custom message when provided', () => {
      expect(() =>
        assertTaskNotDone(
          'task-1',
          WorkshopTaskStatus.DONE,
          'Custom error message',
        ),
      ).toThrow('Custom error message');
    });

    it('does not throw when status is not DONE', () => {
      expect(() =>
        assertTaskNotDone('task-1', WorkshopTaskStatus.IN_PROGRESS),
      ).not.toThrow();
    });
  });

  describe('assertTaskAccessibleAndNotDone', () => {
    it('validates accessibility and not done status', () => {
      const task = {
        id: 'task-1',
        status: WorkshopTaskStatus.IN_PROGRESS,
        mechanic_id: mechanicId,
        bay_id: null,
        workshop_order: { mechanic_id: null, bay_id: null },
      };
      expect(() =>
        assertTaskAccessibleAndNotDone(task, 'task-1', mechanicId),
      ).not.toThrow();
    });

    it('throws UnprocessableEntityException if completed', () => {
      const task = {
        id: 'task-1',
        status: WorkshopTaskStatus.DONE,
        mechanic_id: mechanicId,
        bay_id: null,
        workshop_order: { mechanic_id: null, bay_id: null },
      };
      expect(() =>
        assertTaskAccessibleAndNotDone(task, 'task-1', mechanicId),
      ).toThrow(UnprocessableEntityException);
    });
  });
});
