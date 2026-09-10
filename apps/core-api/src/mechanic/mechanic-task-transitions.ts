import { ConflictException } from '@nestjs/common';
import {
  LaborPauseReason,
  type Prisma,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import type { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service';

/**
 * Maps a `LaborPauseReason` to the resulting `WorkshopTaskStatus` for that
 * task after the labor entry is closed. Returns `null` when the status
 * should remain unchanged (i.e. `OTHER` keeps the task `IN_PROGRESS`).
 *
 * ADR-0014 §4.3 pause-reason mapping table.
 */
export function pauseReasonToTaskStatus(
  reason: LaborPauseReason,
): WorkshopTaskStatus | null {
  switch (reason) {
    case LaborPauseReason.WAITING_PARTS:
      return WorkshopTaskStatus.WAITING_PARTS;
    case LaborPauseReason.WAITING_CUSTOMER:
      return WorkshopTaskStatus.WAITING_CUSTOMER;
    case LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY:
      return WorkshopTaskStatus.PAUSED;
    case LaborPauseReason.OTHER:
      return null; // task remains IN_PROGRESS
    case LaborPauseReason.AUTO_SHIFT_CLOSE:
      return null; // scheduler-only: no task status change
  }
}

export interface CloseLaborAndTransitionParams {
  tenantId: string;
  openEntryId: string;
  taskId: string;
  pauseReason: LaborPauseReason;
  nextTaskStatus: WorkshopTaskStatus | null;
  taskLabel?: string;
}

/**
 * Atomically closes an active labor entry and transitions the task status
 * with concurrency protection.
 */
export async function closeLaborEntryAndTransitionTask(
  tx: Prisma.TransactionClient,
  params: CloseLaborAndTransitionParams,
): Promise<void> {
  const { tenantId, openEntryId, taskId, pauseReason, nextTaskStatus } = params;
  const label = params.taskLabel ?? `Task ${taskId}`;

  const laborEntryUpdate = await tx.laborEntry.updateMany({
    where: {
      id: openEntryId,
      tenant_id: tenantId,
      ended_at: null,
    },
    data: {
      ended_at: new Date(),
      pause_reason: pauseReason,
    },
  });

  if (laborEntryUpdate.count === 0) {
    throw new ConflictException(
      `Open labor entry ${openEntryId} changed concurrently. Please refresh and try again.`,
    );
  }

  if (nextTaskStatus !== null) {
    const taskUpdate = await tx.workshopTask.updateMany({
      where: {
        id: taskId,
        tenant_id: tenantId,
        status: WorkshopTaskStatus.IN_PROGRESS,
      },
      data: { status: nextTaskStatus },
    });

    if (taskUpdate.count === 0) {
      throw new ConflictException(
        `${label} status changed concurrently. Please refresh and try again.`,
      );
    }
  }
}

export interface StartLaborAndTransitionParams {
  tenantId: string;
  taskId: string;
  mechanicId: string;
  taskWasAlreadyInProgress: boolean;
  taskLabel?: string;
}

/**
 * Atomically guards task transition to IN_PROGRESS and creates a new LaborEntry.
 */
export async function startLaborAndTransitionTask(
  tx: Prisma.TransactionClient,
  params: StartLaborAndTransitionParams,
): Promise<void> {
  const { tenantId, taskId, mechanicId, taskWasAlreadyInProgress } = params;
  const label = params.taskLabel ?? `Task ${taskId}`;

  if (!taskWasAlreadyInProgress) {
    const taskUpdate = await tx.workshopTask.updateMany({
      where: {
        id: taskId,
        tenant_id: tenantId,
        status: {
          notIn: [WorkshopTaskStatus.IN_PROGRESS, WorkshopTaskStatus.DONE],
        },
      },
      data: { status: WorkshopTaskStatus.IN_PROGRESS },
    });

    if (taskUpdate.count === 0) {
      throw new ConflictException(
        `${label} status changed concurrently. Please refresh and try again.`,
      );
    }
  }

  await tx.laborEntry.create({
    data: {
      tenant_id: tenantId,
      workshop_task_id: taskId,
      employee_id: mechanicId,
      started_at: new Date(),
    },
  });
}

/**
 * Ensures the parent order is IN_PROGRESS when task work begins.
 */
export async function ensureOrderInProgress(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<void> {
  await tx.workshopOrder.updateMany({
    where: {
      id: orderId,
      tenant_id: tenantId,
      NOT: {
        status: {
          in: [
            WorkshopOrderStatus.IN_PROGRESS,
            WorkshopOrderStatus.COMPLETED,
            WorkshopOrderStatus.INVOICED,
          ],
        },
      },
    },
    data: { status: WorkshopOrderStatus.IN_PROGRESS },
  });
}

export interface CompleteLaborAndTaskParams {
  tenantId: string;
  taskId: string;
  orderId: string;
  openEntryId: string | null;
  allOtherTasksDone: boolean;
}

/**
 * Atomically completes active labor, marks task DONE, and transitions
 * order to COMPLETED if all other tasks are complete.
 */
export async function completeLaborAndTask(
  tx: Prisma.TransactionClient,
  vehicleLedger: VehicleLedgerService,
  params: CompleteLaborAndTaskParams,
): Promise<void> {
  const { tenantId, taskId, orderId, openEntryId, allOtherTasksDone } = params;

  if (openEntryId) {
    const laborEntryUpdate = await tx.laborEntry.updateMany({
      where: {
        id: openEntryId,
        tenant_id: tenantId,
        ended_at: null,
      },
      data: { ended_at: new Date() },
    });

    if (laborEntryUpdate.count === 0) {
      throw new ConflictException(
        `Open labor entry ${openEntryId} changed concurrently. Please refresh and try again.`,
      );
    }
  }

  const taskUpdate = await tx.workshopTask.updateMany({
    where: {
      id: taskId,
      tenant_id: tenantId,
      status: { not: WorkshopTaskStatus.DONE },
    },
    data: { status: WorkshopTaskStatus.DONE },
  });

  if (taskUpdate.count === 0) {
    throw new ConflictException(
      `Task ${taskId} status changed concurrently. Please refresh and try again.`,
    );
  }

  if (allOtherTasksDone) {
    const completed = await tx.workshopOrder.updateMany({
      where: {
        id: orderId,
        tenant_id: tenantId,
        status: WorkshopOrderStatus.IN_PROGRESS,
      },
      data: { status: WorkshopOrderStatus.COMPLETED },
    });
    if (completed.count > 0) {
      await vehicleLedger.completeStockPrep(tx, tenantId, orderId);
    }
  }
}
