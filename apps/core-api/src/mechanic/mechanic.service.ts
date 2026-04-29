import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LaborPauseReason,
  Prisma,
  WorkshopLineItemType,
  WorkshopMediaUrlStrategy,
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
import type { SaveDiagnosticsDto } from './dto/save-diagnostics.dto';
import type { SaveDiagnosticsResponseDto } from './dto/save-diagnostics.dto';
import type { RequestPartDto } from './dto/request-part.dto';
import type { RequestPartResponseDto } from './dto/request-part.dto';
import type { CreateMediaDto, RequestMediaUploadDto } from './dto/media.dto';
import type { MediaUploadPolicyDto, WorkshopMediaDto } from './dto/media.dto';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from './dto/media.dto';
import {
  IMAGE_MIME_TYPES,
  MechanicMediaStorage,
} from './mechanic-media.storage';
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
  /**
   * Cached on first use; undefined when the env var is absent (e.g. during
   * OpenAPI generation).  Methods that actually need the bucket call
   * `getWorkshopMediaBucket()` which throws lazily so the app can still start
   * without this var set.
   */
  private readonly workshopMediaBucket: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly realtimeService: DashboardRealtimeService,
    private readonly eventEmitter: EventEmitter2,
    private readonly mediaStorage: MechanicMediaStorage,
  ) {
    this.workshopMediaBucket = process.env.WORKSHOP_MEDIA_BUCKET;
  }

  /** Returns the configured bucket name or throws at call time (not startup). */
  private getWorkshopMediaBucket(): string {
    if (!this.workshopMediaBucket) {
      throw new InternalServerErrorException(
        'WORKSHOP_MEDIA_BUCKET environment variable is not configured.',
      );
    }
    return this.workshopMediaBucket;
  }

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
   * Returns `409 Conflict` if the mechanic already has an open `LaborEntry`
   * on a *different* task (use the switch endpoint instead).
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
          select: { mechanic_id: true, bay_id: true },
        },
        bay: { select: { id: true, name: true } },
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

    // Reject if this task already has an active labor entry (already being worked on).
    const openEntryForTask = await this.prisma.laborEntry.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_task_id: taskId,
        ended_at: null,
      },
      select: { id: true },
    });

    if (openEntryForTask) {
      throw new UnprocessableEntityException(
        `Task ${taskId} already has an active labor entry.`,
      );
    }

    // Reject if the mechanic has an open entry on a *different* task; they must switch.
    const openEntryElsewhere = await this.prisma.laborEntry.findFirst({
      where: { tenant_id: tenantId, employee_id: mechanicId, ended_at: null },
      select: { id: true },
    });

    if (openEntryElsewhere) {
      throw new ConflictException(
        `Mechanic ${mechanicId} already has an open labor entry. Use the switch endpoint to change tasks.`,
      );
    }

    const taskWasAlreadyInProgress =
      task.status === WorkshopTaskStatus.IN_PROGRESS;

    await this.prisma.$transaction(async (tx) => {
      // Guard the task transition first so a concurrent change fails the transaction.
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
            `Task ${taskId} status changed concurrently. Please refresh and try again.`,
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

      // Ensure the parent order is IN_PROGRESS when work begins.
      await tx.workshopOrder.updateMany({
        where: {
          id: task.workshop_order_id,
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
        workshop_order: {
          select: { mechanic_id: true, bay_id: true },
        },
        bay: { select: { id: true, name: true } },
      },
    });

    if (!targetTask) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(targetTask, mechanicId);

    if (targetTask.status === WorkshopTaskStatus.DONE) {
      throw new UnprocessableEntityException(
        `Target task ${taskId} is already completed.`,
      );
    }

    // Reject if the target task already has an active labor entry
    // (someone else is working it or a duplicate switch was issued).
    const openEntryForTarget = await this.prisma.laborEntry.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_task_id: taskId,
        ended_at: null,
      },
      select: { id: true },
    });

    if (openEntryForTarget) {
      throw new UnprocessableEntityException(
        `Target task ${taskId} already has an active labor entry.`,
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
      dto.previousPauseReason,
    );

    const targetWasAlreadyInProgress =
      targetTask.status === WorkshopTaskStatus.IN_PROGRESS;

    await this.prisma.$transaction(async (tx) => {
      // Close the existing labor entry.
      await tx.laborEntry.update({
        where: { id: openEntry.id },
        data: {
          ended_at: new Date(),
          pause_reason: dto.previousPauseReason,
        },
      });

      // Transition the previous task using an atomic guard.
      if (previousTaskNextStatus !== null) {
        const prevUpdate = await tx.workshopTask.updateMany({
          where: {
            id: previousTaskId,
            tenant_id: tenantId,
            status: WorkshopTaskStatus.IN_PROGRESS,
          },
          data: { status: previousTaskNextStatus },
        });

        if (prevUpdate.count === 0) {
          throw new ConflictException(
            `Previous task ${previousTaskId} status changed concurrently. Please refresh and try again.`,
          );
        }
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
      // If target was already IN_PROGRESS (resumed task), count=0 is expected.
      if (!targetWasAlreadyInProgress) {
        const targetUpdate = await tx.workshopTask.updateMany({
          where: {
            id: taskId,
            tenant_id: tenantId,
            status: {
              notIn: [WorkshopTaskStatus.IN_PROGRESS, WorkshopTaskStatus.DONE],
            },
          },
          data: { status: WorkshopTaskStatus.IN_PROGRESS },
        });

        if (targetUpdate.count === 0) {
          throw new ConflictException(
            `Target task ${taskId} status changed concurrently. Please refresh and try again.`,
          );
        }
      }

      // Ensure the parent order is IN_PROGRESS.
      await tx.workshopOrder.updateMany({
        where: {
          id: targetTask.workshop_order_id,
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
    if (dto.previousPauseReason === LaborPauseReason.WAITING_CUSTOMER) {
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
        workshop_order: {
          select: { mechanic_id: true, bay_id: true },
        },
        bay: { select: { id: true, name: true } },
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

    const nextTaskStatus = pauseReasonToTaskStatus(dto.pauseReason);

    await this.prisma.$transaction(async (tx) => {
      await tx.laborEntry.update({
        where: { id: openEntry.id },
        data: { ended_at: new Date(), pause_reason: dto.pauseReason },
      });

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
            `Task ${taskId} status changed concurrently. Please refresh and try again.`,
          );
        }
      }
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: taskId,
    });

    if (dto.pauseReason === LaborPauseReason.WAITING_CUSTOMER) {
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
          select: {
            mechanic_id: true,
            bay_id: true,
            tasks: { select: { id: true, status: true } },
          },
        },
        bay: { select: { id: true, name: true } },
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

  // ─── Diagnostics ──────────────────────────────────────────────────────────

  /**
   * Debounced auto-save for mechanic notes and inspection checklist values.
   *
   * All payload fields are optional; the client sends whatever changed during
   * the 750 ms debounce window (ADR-0014 §5.1).
   *
   * - `mechanicNotes` is persisted to `WorkshopTask.mechanic_notes`.
   * - `inspectionItems` are upserted into the specified `WorkshopInspection`.
   */
  async saveDiagnostics(
    mechanicId: string,
    taskId: string,
    dto: SaveDiagnosticsDto,
  ): Promise<SaveDiagnosticsResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        bay_id: true,
        mechanic_id: true,
        mechanic_notes: true,
        workshop_order: { select: { mechanic_id: true, bay_id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    await this.prisma.$transaction(async (tx) => {
      // Persist mechanic notes when provided.
      if (dto.mechanicNotes !== undefined) {
        await tx.workshopTask.update({
          where: { id: taskId },
          data: { mechanic_notes: dto.mechanicNotes },
        });
      }

      // Upsert inspection item values when provided.
      if (
        dto.inspectionId &&
        dto.inspectionItems &&
        dto.inspectionItems.length > 0
      ) {
        // Validate that the inspection belongs to this task/tenant.
        const inspection = await tx.workshopInspection.findFirst({
          where: {
            id: dto.inspectionId,
            tenant_id: tenantId,
            workshop_task_id: taskId,
          },
          select: { id: true },
        });

        if (!inspection) {
          throw new NotFoundException(
            `Inspection ${dto.inspectionId} not found for task ${taskId}.`,
          );
        }

        // Batch update: map each item value to an update query and resolve concurrently.
        // Each update is scoped to tenant + inspection + item; we verify the count so
        // that stale or wrong item IDs fail loudly rather than silently (ADR-0014 §5.1).
        const updateResults = await Promise.all(
          dto.inspectionItems.map((item) =>
            tx.workshopInspectionItem.updateMany({
              where: {
                id: item.itemId,
                tenant_id: tenantId,
                workshop_inspection_id: dto.inspectionId!,
              },
              data: {
                ...(item.responseValue !== undefined
                  ? { response_value: item.responseValue }
                  : {}),
                ...(item.passed !== undefined ? { passed: item.passed } : {}),
                ...(item.severity !== undefined
                  ? { severity: item.severity }
                  : {}),
                ...(item.notes !== undefined ? { notes: item.notes } : {}),
              },
            }),
          ),
        );

        const notFound = dto.inspectionItems.filter(
          (_, i) => updateResults[i].count === 0,
        );
        if (notFound.length > 0) {
          throw new NotFoundException(
            `Inspection item(s) not found: ${notFound.map((i) => i.itemId).join(', ')}.`,
          );
        }
      }
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: taskId,
    });

    // Re-fetch the latest notes for the response.
    const updated = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: { id: true, mechanic_notes: true },
    });

    return {
      taskId,
      mechanicNotes: updated?.mechanic_notes ?? null,
    } satisfies SaveDiagnosticsResponseDto;
  }

  // ─── Parts Requisition ─────────────────────────────────────────────────────

  /**
   * Creates a new part request line (`WorkshopTaskLineItem` of type PART) with
   * `part_execution_status = PENDING_PICK`.
   *
   * Stock is NOT deducted by this operation.  The parts department picks and
   * stages the part through the kitting/tote workflow (ADR-0014 §6.1,
   * ADR-0012).
   *
   * Cost and pricing fields are intentionally excluded from the DTO;
   * mechanics must not see or set financial data (ADR-0014 §6.3, §8.2).
   */
  async requestPart(
    mechanicId: string,
    taskId: string,
    dto: RequestPartDto,
  ): Promise<RequestPartResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        bay_id: true,
        status: true,
        mechanic_id: true,
        workshop_order: { select: { mechanic_id: true, bay_id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    if (task.status === WorkshopTaskStatus.DONE) {
      throw new UnprocessableEntityException(
        `Cannot add parts to completed task ${taskId}.`,
      );
    }

    const lineItem = await this.prisma.workshopTaskLineItem.create({
      data: {
        tenant_id: tenantId,
        workshop_task_id: taskId,
        type: WorkshopLineItemType.PART,
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
        item_no: dto.itemNo,
        description: dto.description,
        quantity: new Prisma.Decimal(dto.qty),
        // Mechanics do not set cost/price — defaults to zero; financial
        // staff update pricing through the back-office workshop service.
        unit_price: new Prisma.Decimal(0),
      },
      select: {
        id: true,
        item_no: true,
        description: true,
        quantity: true,
        part_execution_status: true,
      },
    });

    // The Prisma dashboard-realtime extension emits WORKSHOP_TASK_LINE_ITEM CREATED
    // automatically for this create; no manual emit is needed.

    return {
      id: lineItem.id,
      itemNo: lineItem.item_no,
      description: lineItem.description,
      qty: Number(lineItem.quantity),
      partExecutionStatus:
        lineItem.part_execution_status ??
        WorkshopPartLineExecutionStatus.PENDING_PICK,
    } satisfies RequestPartResponseDto;
  }

  // ─── Media Upload Policy ───────────────────────────────────────────────────

  /**
   * Generates a short-lived GCS presigned POST upload policy for direct-to-
   * storage upload (ADR-0014 §7.1).
   *
   * The client must call `POST /media` after successfully uploading to
   * persist the metadata (ADR-0014 §7.2).
   */
  async createMediaUploadPolicy(
    mechanicId: string,
    taskId: string,
    dto: RequestMediaUploadDto,
  ): Promise<MediaUploadPolicyDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        bay_id: true,
        status: true,
        mechanic_id: true,
        workshop_order_id: true,
        workshop_order: { select: { mechanic_id: true, bay_id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    if (task.status === WorkshopTaskStatus.DONE) {
      throw new UnprocessableEntityException(
        `Cannot upload media for completed task ${taskId}.`,
      );
    }

    const policy = await this.mediaStorage.generateUploadPolicy({
      tenantId,
      orderId: task.workshop_order_id,
      taskId,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      filename: dto.filename,
    });

    return {
      uploadUrl: policy.uploadUrl,
      formFields: policy.formFields,
      storageBucket: policy.storageBucket,
      storageKey: policy.storageKey,
      expiresAt: policy.expiresAt.toISOString(),
    } satisfies MediaUploadPolicyDto;
  }

  // ─── Media Metadata Persist ────────────────────────────────────────────────

  /**
   * Persists `WorkshopMedia` metadata after a successful direct upload.
   *
   * Media metadata is stored only after the upload policy was successfully
   * used and the client confirms the upload.  File blobs are never written
   * to Postgres (ADR-0014 §7.1).
   */
  async saveMediaMetadata(
    mechanicId: string,
    taskId: string,
    dto: CreateMediaDto,
  ): Promise<WorkshopMediaDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        bay_id: true,
        status: true,
        mechanic_id: true,
        workshop_order_id: true,
        workshop_order: { select: { mechanic_id: true, bay_id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    this.assertTaskAssignedToMechanic(task, mechanicId);

    if (task.status === WorkshopTaskStatus.DONE) {
      throw new UnprocessableEntityException(
        `Cannot persist media for completed task ${taskId}.`,
      );
    }

    // Validate that the client-supplied bucket and key refer to the expected
    // tenant/order/task-scoped location.  This prevents callers from pointing
    // WorkshopMedia records at arbitrary buckets or objects outside their scope
    // (ADR-0014 §7.2 security).
    if (dto.storageBucket !== this.getWorkshopMediaBucket()) {
      throw new BadRequestException(
        `Invalid storage bucket. Expected "${this.getWorkshopMediaBucket()}".`,
      );
    }
    const expectedKeyPrefix = `tenants/${tenantId}/orders/${task.workshop_order_id}/tasks/${taskId}/`;
    if (!dto.storageKey.startsWith(expectedKeyPrefix)) {
      throw new BadRequestException(
        `Invalid storage key. Key must start with "${expectedKeyPrefix}".`,
      );
    }

    // Enforce the same per-MIME-type size caps used by the upload policy endpoint.
    const isImage = IMAGE_MIME_TYPES.has(dto.mimeType);
    const hardCap = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (dto.sizeBytes > hardCap) {
      throw new BadRequestException(
        `Reported file size ${dto.sizeBytes} bytes exceeds the maximum allowed for ${dto.mimeType} (${hardCap} bytes).`,
      );
    }

    const media = await this.prisma.workshopMedia.create({
      data: {
        tenant_id: tenantId,
        workshop_order_id: task.workshop_order_id,
        workshop_task_id: taskId,
        uploaded_by_employee_id: mechanicId,
        storage_bucket: dto.storageBucket,
        storage_key: dto.storageKey,
        url_strategy: WorkshopMediaUrlStrategy.SIGNED,
        mime_type: dto.mimeType,
        size_bytes: dto.sizeBytes,
        duration_seconds:
          dto.durationSeconds != null
            ? new Prisma.Decimal(dto.durationSeconds)
            : null,
        caption: dto.caption ?? null,
      },
    });

    // The Prisma dashboard-realtime extension emits WORKSHOP_MEDIA CREATED
    // automatically for this create; no manual emit is needed.

    return {
      id: media.id,
      workshopOrderId: media.workshop_order_id,
      workshopTaskId: media.workshop_task_id,
      uploadedByEmployeeId: media.uploaded_by_employee_id,
      storageBucket: media.storage_bucket,
      storageKey: media.storage_key,
      urlStrategy: media.url_strategy,
      mimeType: media.mime_type,
      sizeBytes: media.size_bytes,
      durationSeconds: media.duration_seconds
        ? Number(media.duration_seconds)
        : null,
      caption: media.caption,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    } satisfies WorkshopMediaDto;
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
