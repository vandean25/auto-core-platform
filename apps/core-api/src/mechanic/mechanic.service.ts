import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import {
  LaborPauseReason,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { MechanicQueueItemDto } from './dto/mechanic-queue-item.dto';
import type { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';
import type { PauseTaskDto, SwitchTaskDto } from './dto/task-execution.dto';
import {
  TASK_WAITING_CUSTOMER_EVENT,
  type TaskWaitingCustomerPayload,
} from './mechanic-events.constants';

const QUEUE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

/** Task statuses that remain visible even when scheduled for a previous day. */
const ACTIVE_OR_BLOCKED_STATUSES: WorkshopTaskStatus[] = [
  WorkshopTaskStatus.IN_PROGRESS,
  WorkshopTaskStatus.WAITING_PARTS,
  WorkshopTaskStatus.WAITING_CUSTOMER,
  WorkshopTaskStatus.PAUSED,
];

/** Part-line statuses that the mechanic view exposes (no financial context). */
const VISIBLE_PART_LINE_STATUSES: WorkshopPartLineExecutionStatus[] = [
  WorkshopPartLineExecutionStatus.PENDING_PICK,
  WorkshopPartLineExecutionStatus.STAGED,
  WorkshopPartLineExecutionStatus.CONSUMED,
  WorkshopPartLineExecutionStatus.CANCELLED,
];

/**
 * Builds the scheduled-date OR filter for the mechanic queue (ADR-0014 §3.1):
 *  - Unscheduled tasks are always included.
 *  - Today's scheduled tasks are always included.
 *  - Tasks scheduled for a previous day are only included when still
 *    active or blocked (carry-forward).
 */
function buildScheduledDateFilter(
  today: Date,
  activeStatuses: WorkshopTaskStatus[],
): Prisma.WorkshopTaskWhereInput {
  return {
    OR: [
      { scheduled_date: null },
      { scheduled_date: today },
      {
        scheduled_date: { lt: today },
        status: { in: activeStatuses },
      },
    ],
  };
}

/**
 * Maps a `LaborPauseReason` to the resulting `WorkshopTaskStatus` for that
 * task after the labor entry is closed. Returns `null` when the status
 * should remain unchanged (i.e. `OTHER` keeps the task `IN_PROGRESS`).
 *
 * ADR-0014 §4.3 pause-reason mapping table.
 */
function pauseReasonToTaskStatus(
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

@Injectable()
export class MechanicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly realtimeService: DashboardRealtimeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Resolves and validates the current authenticated user as a MECHANIC
   * employee for the given tenant.
   *
   * Throws ForbiddenException if the user is not a TECH tenant member.
   * Throws NotFoundException if no active MECHANIC employee exists for the
   * given mechanicId within the tenant.
   */
  async assertMechanicAccess(mechanicId: string): Promise<void> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || user.role !== 'TECH') {
      throw new ForbiddenException(
        'Only technicians (TECH role) may access mechanic endpoints.',
      );
    }

    const tenantId = await this.tenantContext.getTenantId();

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: mechanicId,
        tenant_id: tenantId,
        role: 'MECHANIC',
        is_active: true,
      },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException(
        `Active mechanic employee ${mechanicId} not found in this tenant.`,
      );
    }
  }

  /**
   * Returns the active work queue for the given mechanic.
   *
   * Implemented as a single `findMany` against `WorkshopTask` (ADR-0014 §3.2).
   * Applies assignment-inheritance rules from ADR-0014 §2.2.
   * Returned projection excludes all customer PII and financial fields.
   */
  async getMechanicQueue(mechanicId: string): Promise<MechanicQueueItemDto[]> {
    const tenantId = await this.tenantContext.getTenantId();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // One findMany — no secondary row-level lookups (ADR-0014 §3.2 constraint).
    const tasks = await this.prisma.workshopTask.findMany({
      where: {
        tenant_id: tenantId,
        status: { not: WorkshopTaskStatus.DONE },
        workshop_order: {
          status: { in: QUEUE_ORDER_STATUSES },
        },
        // Scheduled-date filter: today's tasks, unscheduled tasks, or
        // carry-forward tasks that are still active/blocked.
        ...buildScheduledDateFilter(today, ACTIVE_OR_BLOCKED_STATUSES),
        // Assignment-inheritance filter (ADR-0014 §2.2):
        //   Rule 1: task.mechanic_id = mechanicId
        //   Rule 3 fallback: task has no mechanic override,
        //                    parent order is assigned to this mechanic
        OR: [
          { mechanic_id: mechanicId },
          {
            mechanic_id: null,
            workshop_order: { mechanic_id: mechanicId },
          },
        ],
      },
      include: {
        workshop_order: {
          include: {
            vehicle: true,
          },
        },
        bay: { select: { id: true, name: true } },
        line_items: {
          where: { part_execution_status: { in: VISIBLE_PART_LINE_STATUSES } },
          select: {
            id: true,
            description: true,
            qty: true,
            part_execution_status: true,
          },
        },
      },
      orderBy: [
        { sequence: 'asc' },
        { scheduled_date: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return tasks.map((task) => {
      const order = task.workshop_order;
      const vehicle = order.vehicle;

      // Resolve bay: task-level overrides order-level (ADR-0014 §2.2)
      const bay = task.bay ?? null;

      return {
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        orderId: order.id,
        orderNumber: order.order_number,
        reportedComplaint: order.reported_issue ?? null,
        vehicle: {
          id: vehicle.id,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          plate: vehicle.plate ?? null,
        },
        bay: bay ? { id: bay.id, name: bay.name } : null,
        sequence: task.sequence,
        scheduledDate: task.scheduled_date
          ? task.scheduled_date.toISOString().split('T')[0]
          : null,
        partLines: task.line_items.map((li) => ({
          id: li.id,
          description: li.description,
          qty: li.qty,
          partExecutionStatus: li.part_execution_status ?? null,
        })),
        updatedAt: task.updatedAt,
      } satisfies MechanicQueueItemDto;
    });
  }

  /**
   * Returns the restricted task-detail projection for a single task.
   *
   * Access is denied when the task is not reachable by the mechanic
   * following ADR-0014 §2.2 assignment-inheritance rules.
   */
  async getMechanicTaskDetail(
    mechanicId: string,
    taskId: string,
  ): Promise<MechanicTaskDetailDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: {
        id: taskId,
        tenant_id: tenantId,
      },
      include: {
        workshop_order: {
          include: {
            vehicle: true,
          },
        },
        bay: { select: { id: true, name: true } },
        line_items: {
          select: {
            id: true,
            type: true,
            description: true,
            qty: true,
            part_execution_status: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    const order = task.workshop_order;
    const vehicle = order.vehicle;
    const bay = task.bay ?? null;

    return {
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
      mechanicNotes: task.mechanic_notes ?? null,
      orderId: order.id,
      orderNumber: order.order_number,
      reportedComplaint: order.reported_issue ?? null,
      odometer: order.odometer,
      vehicle: {
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vin: vehicle.vin ?? null,
        plate: vehicle.plate ?? null,
      },
      bay: bay ? { id: bay.id, name: bay.name } : null,
      sequence: task.sequence,
      scheduledDate: task.scheduled_date
        ? task.scheduled_date.toISOString().split('T')[0]
        : null,
      lineItems: task.line_items.map((li) => ({
        id: li.id,
        type: li.type,
        description: li.description,
        qty: li.qty,
        partExecutionStatus: li.part_execution_status ?? null,
      })),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    } satisfies MechanicTaskDetailDto;
  }

  // ─── Execution Engine ──────────────────────────────────────────────────────

  /**
   * Punch in: creates a `LaborEntry` and transitions the task to `IN_PROGRESS`.
   *
   * Returns `409 Conflict` if the mechanic already has an open `LaborEntry`.
   * ADR-0014 §4.2
   */
  async startTask(
    mechanicId: string,
    taskId: string,
  ): Promise<MechanicTaskDetailDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      include: {
        workshop_order: {
          include: { vehicle: true },
        },
        bay: { select: { id: true, name: true } },
        line_items: {
          select: {
            id: true,
            type: true,
            description: true,
            qty: true,
            part_execution_status: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    if (
      task.status === WorkshopTaskStatus.DONE ||
      task.status === WorkshopTaskStatus.IN_PROGRESS
    ) {
      throw new UnprocessableEntityException(
        `Task ${taskId} is not eligible to start (status: ${task.status}).`,
      );
    }

    const openEntry = await this.prisma.laborEntry.findFirst({
      where: { tenant_id: tenantId, employee_id: mechanicId, ended_at: null },
      select: { id: true },
    });

    if (openEntry) {
      throw new ConflictException(
        `Mechanic ${mechanicId} already has an open labor entry. Use the switch endpoint to change tasks.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.laborEntry.create({
        data: {
          tenant_id: tenantId,
          workshop_task_id: taskId,
          employee_id: mechanicId,
          started_at: new Date(),
        },
      });

      await tx.workshopTask.updateMany({
        where: {
          id: taskId,
          tenant_id: tenantId,
          status: {
            notIn: [WorkshopTaskStatus.IN_PROGRESS, WorkshopTaskStatus.DONE],
          },
        },
        data: { status: WorkshopTaskStatus.IN_PROGRESS },
      });

      // Ensure the parent order is IN_PROGRESS when work begins.
      await tx.workshopOrder.updateMany({
        where: {
          id: task.workshop_order_id,
          tenant_id: tenantId,
          status: { not: WorkshopOrderStatus.IN_PROGRESS },
          // Guard: do not downgrade a COMPLETED or INVOICED order.
          NOT: {
            status: {
              in: [WorkshopOrderStatus.COMPLETED, WorkshopOrderStatus.INVOICED],
            },
          },
        },
        data: { status: WorkshopOrderStatus.IN_PROGRESS },
      });
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: taskId,
    });

    return this.getMechanicTaskDetail(mechanicId, taskId);
  }

  /**
   * Switch task: atomically closes the mechanic's current open labor entry,
   * transitions the previous task status, opens a new labor entry for the
   * target task, and transitions the target task to `IN_PROGRESS`.
   *
   * Returns `409 Conflict` if the mechanic has no open labor entry to switch from.
   * ADR-0014 §4.2.1
   */
  async switchTask(
    mechanicId: string,
    taskId: string,
    dto: SwitchTaskDto,
  ): Promise<MechanicTaskDetailDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const targetTask = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      include: {
        workshop_order: { include: { vehicle: true } },
        bay: { select: { id: true, name: true } },
        line_items: {
          select: {
            id: true,
            type: true,
            description: true,
            qty: true,
            part_execution_status: true,
          },
        },
      },
    });

    if (!targetTask) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(targetTask, mechanicId);

    if (
      targetTask.status === WorkshopTaskStatus.DONE ||
      targetTask.status === WorkshopTaskStatus.IN_PROGRESS
    ) {
      throw new UnprocessableEntityException(
        `Target task ${taskId} is not eligible to start (status: ${targetTask.status}).`,
      );
    }

    const openEntry = await this.prisma.laborEntry.findFirst({
      where: { tenant_id: tenantId, employee_id: mechanicId, ended_at: null },
      select: {
        id: true,
        workshop_task_id: true,
        workshop_task: { select: { workshop_order_id: true } },
      },
    });

    if (!openEntry) {
      throw new ConflictException(
        `Mechanic ${mechanicId} has no open labor entry to switch from. Use the start endpoint instead.`,
      );
    }

    const previousTaskId = openEntry.workshop_task_id;
    const previousOrderId = openEntry.workshop_task.workshop_order_id;
    const previousTaskNextStatus = pauseReasonToTaskStatus(
      dto.previous_pause_reason,
    );

    await this.prisma.$transaction(async (tx) => {
      // Close the existing labor entry.
      await tx.laborEntry.update({
        where: { id: openEntry.id },
        data: {
          ended_at: new Date(),
          pause_reason: dto.previous_pause_reason,
        },
      });

      // Transition the previous task using an atomic guard.
      if (previousTaskNextStatus !== null) {
        await tx.workshopTask.updateMany({
          where: {
            id: previousTaskId,
            tenant_id: tenantId,
            status: WorkshopTaskStatus.IN_PROGRESS,
          },
          data: { status: previousTaskNextStatus },
        });
      }

      // Open a new labor entry for the target task.
      await tx.laborEntry.create({
        data: {
          tenant_id: tenantId,
          workshop_task_id: taskId,
          employee_id: mechanicId,
          started_at: new Date(),
        },
      });

      // Transition the target task to IN_PROGRESS (atomic guard).
      await tx.workshopTask.updateMany({
        where: {
          id: taskId,
          tenant_id: tenantId,
          status: {
            notIn: [WorkshopTaskStatus.IN_PROGRESS, WorkshopTaskStatus.DONE],
          },
        },
        data: { status: WorkshopTaskStatus.IN_PROGRESS },
      });

      // Ensure the parent order is IN_PROGRESS.
      await tx.workshopOrder.updateMany({
        where: {
          id: targetTask.workshop_order_id,
          tenant_id: tenantId,
          NOT: {
            status: {
              in: [WorkshopOrderStatus.COMPLETED, WorkshopOrderStatus.INVOICED],
            },
          },
        },
        data: { status: WorkshopOrderStatus.IN_PROGRESS },
      });
    });

    // Emit realtime for both the previous task and the target task.
    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: previousTaskId,
    });
    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: taskId,
    });

    // If the previous task moved to WAITING_CUSTOMER, emit the notification event.
    // Use the previous task's own order ID (fetched via the open-entry join above),
    // not the target task's order ID, since the tasks may belong to different orders.
    if (dto.previous_pause_reason === LaborPauseReason.WAITING_CUSTOMER) {
      this.eventEmitter.emit(TASK_WAITING_CUSTOMER_EVENT, {
        tenantId,
        taskId: previousTaskId,
        orderId: previousOrderId,
        mechanicId,
      } satisfies TaskWaitingCustomerPayload);
    }

    return this.getMechanicTaskDetail(mechanicId, taskId);
  }

  /**
   * Pause: closes the active `LaborEntry` and transitions the task status
   * based on the supplied pause reason.
   *
   * When the resulting status is `WAITING_CUSTOMER`, publishes a domain
   * event so the Service Advisor notification flow can be triggered.
   * ADR-0014 §4.3
   */
  async pauseTask(
    mechanicId: string,
    taskId: string,
    dto: PauseTaskDto,
  ): Promise<MechanicTaskDetailDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      include: {
        workshop_order: { include: { vehicle: true } },
        bay: { select: { id: true, name: true } },
        line_items: {
          select: {
            id: true,
            type: true,
            description: true,
            qty: true,
            part_execution_status: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    const openEntry = await this.prisma.laborEntry.findFirst({
      where: {
        tenant_id: tenantId,
        employee_id: mechanicId,
        workshop_task_id: taskId,
        ended_at: null,
      },
      select: { id: true },
    });

    if (!openEntry) {
      throw new ConflictException(
        `No open labor entry found for mechanic ${mechanicId} on task ${taskId}.`,
      );
    }

    const nextTaskStatus = pauseReasonToTaskStatus(dto.pause_reason);

    await this.prisma.$transaction(async (tx) => {
      await tx.laborEntry.update({
        where: { id: openEntry.id },
        data: { ended_at: new Date(), pause_reason: dto.pause_reason },
      });

      if (nextTaskStatus !== null) {
        await tx.workshopTask.updateMany({
          where: {
            id: taskId,
            tenant_id: tenantId,
            status: WorkshopTaskStatus.IN_PROGRESS,
          },
          data: { status: nextTaskStatus },
        });
      }
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: taskId,
    });

    if (dto.pause_reason === LaborPauseReason.WAITING_CUSTOMER) {
      this.eventEmitter.emit(TASK_WAITING_CUSTOMER_EVENT, {
        tenantId,
        taskId,
        orderId: task.workshop_order_id,
        mechanicId,
      } satisfies TaskWaitingCustomerPayload);
    }

    return this.getMechanicTaskDetail(mechanicId, taskId);
  }

  /**
   * Complete task: closes any active `LaborEntry`, transitions the task to
   * `DONE`, and optionally completes the parent order when all tasks are done.
   * ADR-0014 §4.4
   */
  async completeTask(
    mechanicId: string,
    taskId: string,
  ): Promise<MechanicTaskDetailDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      include: {
        workshop_order: {
          include: {
            vehicle: true,
            tasks: { select: { id: true, status: true } },
          },
        },
        bay: { select: { id: true, name: true } },
        line_items: {
          select: {
            id: true,
            type: true,
            description: true,
            qty: true,
            part_execution_status: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    if (task.status === WorkshopTaskStatus.DONE) {
      throw new UnprocessableEntityException(
        `Task ${taskId} is already completed.`,
      );
    }

    const openEntry = await this.prisma.laborEntry.findFirst({
      where: {
        tenant_id: tenantId,
        employee_id: mechanicId,
        workshop_task_id: taskId,
        ended_at: null,
      },
      select: { id: true },
    });

    const orderId = task.workshop_order_id;
    const remainingTaskIds = task.workshop_order.tasks
      .filter((t) => t.id !== taskId && t.status !== WorkshopTaskStatus.DONE)
      .map((t) => t.id);
    const allOtherTasksDone = remainingTaskIds.length === 0;

    await this.prisma.$transaction(async (tx) => {
      if (openEntry) {
        await tx.laborEntry.update({
          where: { id: openEntry.id },
          data: { ended_at: new Date() },
        });
      }

      await tx.workshopTask.updateMany({
        where: {
          id: taskId,
          tenant_id: tenantId,
          status: { not: WorkshopTaskStatus.DONE },
        },
        data: { status: WorkshopTaskStatus.DONE },
      });

      if (allOtherTasksDone) {
        await tx.workshopOrder.updateMany({
          where: {
            id: orderId,
            tenant_id: tenantId,
            status: WorkshopOrderStatus.IN_PROGRESS,
          },
          data: { status: WorkshopOrderStatus.COMPLETED },
        });
      }
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: taskId,
    });

    return this.getMechanicTaskDetail(mechanicId, taskId);
  }

  /**
   * Checks whether a task is reachable by the given mechanic per
   * ADR-0014 §2.2 assignment-inheritance rules. Throws ForbiddenException
   * when the task is not accessible.
   */
  private assertTaskAssignedToMechanic(
    task: {
      id: string;
      mechanic_id: string | null;
      bay_id: string | null;
      workshop_order: {
        mechanic_id: string | null;
        bay_id: string | null;
      };
    },
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
}
