import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { MechanicQueueItemDto } from './dto/mechanic-queue-item.dto';
import type { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';

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

@Injectable()
export class MechanicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
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

    const tenantId = this.tenantContext.getRequiredTenantId();

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
    const tenantId = this.tenantContext.getRequiredTenantId();

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
        OR: [
          { scheduled_date: null },
          { scheduled_date: today },
          {
            scheduled_date: { lt: today },
            status: { in: ACTIVE_OR_BLOCKED_STATUSES },
          },
        ],
        // Assignment-inheritance filter (ADR-0014 §2.2):
        //   Rule 1: task.mechanic_id = mechanicId
        //   Rule 3 fallback: task has no mechanic override,
        //                    parent order is assigned to this mechanic
        AND: [
          {
            OR: [
              { mechanic_id: mechanicId },
              {
                mechanic_id: null,
                workshop_order: { mechanic_id: mechanicId },
              },
            ],
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
    const tenantId = this.tenantContext.getRequiredTenantId();

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
