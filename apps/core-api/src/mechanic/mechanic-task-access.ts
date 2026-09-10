import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkshopTaskStatus } from '@prisma/client';

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

/**
 * Asserts that a loaded task exists and is assigned to the given mechanic.
 * Throws NotFoundException if null or ForbiddenException if not assigned.
 */
export function assertTaskAccessible<T extends MechanicAssignedTask>(
  task: T | null,
  taskId: string,
  mechanicId: string,
): asserts task is T {
  if (!task) {
    throw new NotFoundException(`Task ${taskId} not found.`);
  }
  assertTaskAssignedToMechanic(task, mechanicId);
}

/**
 * Asserts that a task is not in DONE status. Throws UnprocessableEntityException
 * when already completed.
 */
export function assertTaskNotDone(
  taskId: string,
  status: WorkshopTaskStatus,
  customMessage?: string,
): void {
  if (status === WorkshopTaskStatus.DONE) {
    throw new UnprocessableEntityException(
      customMessage ?? `Task ${taskId} is already completed.`,
    );
  }
}

/**
 * Validates task existence, assignment to mechanic, and active (non-DONE) state.
 */
export function assertTaskAccessibleAndNotDone<
  T extends MechanicAssignedTask & { status: WorkshopTaskStatus },
>(
  task: T | null,
  taskId: string,
  mechanicId: string,
  customNotDoneMessage?: string,
): asserts task is T {
  assertTaskAccessible(task, taskId, mechanicId);
  assertTaskNotDone(taskId, task.status, customNotDoneMessage);
}
