import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LaborPauseReason,
  Prisma,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service';
import type { MechanicQueueItemDto } from './dto/mechanic-queue-item.dto';
import type { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';
import type { PauseTaskDto, SwitchTaskDto } from './dto/task-execution.dto';
import type {
  SaveDiagnosticsDto,
  SaveDiagnosticsResponseDto,
} from './dto/save-diagnostics.dto';
import type {
  RequestPartDto,
  RequestPartResponseDto,
} from './dto/request-part.dto';
import {
  TASK_WAITING_CUSTOMER_EVENT,
  type TaskWaitingCustomerPayload,
} from './mechanic-events.constants';
import {
  assertTaskAccessible,
  assertTaskAccessibleAndNotDone,
} from './mechanic-task-access';
import {
  ACTIVE_OR_BLOCKED_STATUSES,
  QUEUE_ORDER_STATUSES,
  VISIBLE_PART_LINE_STATUSES,
  buildScheduledDateFilter,
  mapToMechanicQueueItem,
  mapToMechanicTaskDetail,
} from './mechanic-queue.mapper';
import {
  closeLaborEntryAndTransitionTask,
  completeLaborAndTask,
  ensureOrderInProgress,
  pauseReasonToTaskStatus,
  startLaborAndTransitionTask,
} from './mechanic-task-transitions';
import {
  processVoiceNoteDraft,
  updateInspectionItems,
  updateTaskNotes,
} from './mechanic-diagnostics.helpers';

@Injectable()
export class MechanicExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly realtimeService: DashboardRealtimeService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vehicleLedger: VehicleLedgerService,
  ) {}

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
            quantity: true,
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

    return tasks.map(mapToMechanicQueueItem);
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
            item_no: true,
            description: true,
            quantity: true,
            part_execution_status: true,
          },
        },
      },
    });

    assertTaskAccessible(task, taskId, mechanicId);

    return mapToMechanicTaskDetail(task);
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

    assertTaskAccessibleAndNotDone(task, taskId, mechanicId);

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
      await startLaborAndTransitionTask(tx, {
        tenantId,
        taskId,
        mechanicId,
        taskWasAlreadyInProgress,
      });

      // Ensure the parent order is IN_PROGRESS when work begins.
      await ensureOrderInProgress(tx, tenantId, task.workshop_order_id);
    });

    this.emitTaskUpdated(tenantId, taskId);

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

    assertTaskAccessibleAndNotDone(
      targetTask,
      taskId,
      mechanicId,
      `Target task ${taskId} is already completed.`,
    );

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
      // Close previous labor entry and transition previous task.
      await closeLaborEntryAndTransitionTask(tx, {
        tenantId,
        openEntryId: openEntry.id,
        taskId: previousTaskId,
        pauseReason: dto.previousPauseReason,
        nextTaskStatus: previousTaskNextStatus,
        taskLabel: `Previous task ${previousTaskId}`,
      });

      // Open new labor entry and transition target task.
      await startLaborAndTransitionTask(tx, {
        tenantId,
        taskId,
        mechanicId,
        taskWasAlreadyInProgress: targetWasAlreadyInProgress,
        taskLabel: `Target task ${taskId}`,
      });

      // Ensure the parent order is IN_PROGRESS.
      await ensureOrderInProgress(tx, tenantId, targetTask.workshop_order_id);
    });

    // Emit realtime for both the previous task and the target task.
    this.emitTaskUpdated(tenantId, previousTaskId);
    this.emitTaskUpdated(tenantId, taskId);

    // If previous task moved to WAITING_CUSTOMER, emit the notification event.
    this.emitWaitingCustomerIfApplicable(
      tenantId,
      previousTaskId,
      previousOrderId,
      mechanicId,
      dto.previousPauseReason,
    );

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

    assertTaskAccessible(task, taskId, mechanicId);

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
      await closeLaborEntryAndTransitionTask(tx, {
        tenantId,
        openEntryId: openEntry.id,
        taskId,
        pauseReason: dto.pauseReason,
        nextTaskStatus,
      });
    });

    this.emitTaskUpdated(tenantId, taskId);

    this.emitWaitingCustomerIfApplicable(
      tenantId,
      taskId,
      task.workshop_order_id,
      mechanicId,
      dto.pauseReason,
    );

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

    assertTaskAccessibleAndNotDone(task, taskId, mechanicId);

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
      await completeLaborAndTask(tx, this.vehicleLedger, {
        tenantId,
        taskId,
        orderId,
        openEntryId: openEntry?.id ?? null,
        allOtherTasksDone,
      });
    });

    this.emitTaskUpdated(tenantId, taskId);

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

    assertTaskAccessible(task, taskId, mechanicId);

    await this.prisma.$transaction(async (tx) => {
      let acceptedDraftText: string | null = null;
      if (dto.voiceNoteDraftId) {
        acceptedDraftText = await processVoiceNoteDraft(
          tx,
          tenantId,
          taskId,
          mechanicId,
          dto.voiceNoteDraftId,
        );
      }

      const effectiveMechanicNotes =
        dto.mechanicNotes !== undefined
          ? dto.mechanicNotes
          : acceptedDraftText !== null
            ? acceptedDraftText
            : undefined;

      if (effectiveMechanicNotes !== undefined) {
        await updateTaskNotes(tx, tenantId, taskId, effectiveMechanicNotes);
      }

      // Upsert inspection item values when provided.
      if (
        dto.inspectionId &&
        dto.inspectionItems &&
        dto.inspectionItems.length > 0
      ) {
        await updateInspectionItems(
          tx,
          tenantId,
          taskId,
          dto.inspectionId,
          dto.inspectionItems,
        );
      }
    });

    this.emitTaskUpdated(tenantId, taskId);

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

    assertTaskAccessibleAndNotDone(
      task,
      taskId,
      mechanicId,
      `Cannot add parts to completed task ${taskId}.`,
    );

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

  // ─── Shared Event Emitters ─────────────────────────────────────────────────

  private emitTaskUpdated(tenantId: string, taskId: string): void {
    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'WORKSHOP_TASK',
      action: 'UPDATED',
      entityId: taskId,
    });
  }

  private emitWaitingCustomerIfApplicable(
    tenantId: string,
    taskId: string,
    orderId: string,
    mechanicId: string,
    pauseReason: LaborPauseReason,
  ): void {
    if (pauseReason === LaborPauseReason.WAITING_CUSTOMER) {
      this.eventEmitter.emit(TASK_WAITING_CUSTOMER_EVENT, {
        tenantId,
        taskId,
        orderId,
        mechanicId,
      } satisfies TaskWaitingCustomerPayload);
    }
  }
}
