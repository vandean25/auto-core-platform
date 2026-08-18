import { ForbiddenException } from '@nestjs/common';

export type MechanicAssignedTask = {
  id: string;
  mechanic_id: string | null;
  bay_id: string | null;
  workshop_order: {
    mechanic_id: string | null;
    bay_id: string | null;
  };
};

/**
 * Checks whether a task is reachable by the given mechanic per
 * ADR-0014 §2.2 assignment-inheritance rules. Throws ForbiddenException
 * when the task is not accessible.
 */
export function assertTaskAssignedToMechanic(
  task: MechanicAssignedTask,
  mechanicId: string,
): void {
  // Rule 1: task directly assigned to this mechanic
  if (task.mechanic_id === mechanicId) {
    return;
  }

  // Rule 2/3: no task-level mechanic override — fall back to order assignment
  if (
    task.mechanic_id === null &&
    task.workshop_order.mechanic_id === mechanicId
  ) {
    return;
  }

  throw new ForbiddenException(
    `Task ${task.id} is not assigned to mechanic ${mechanicId}.`,
  );
}
