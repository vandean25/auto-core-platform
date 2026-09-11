import {
  Prisma,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import type { MechanicQueueItemDto } from './dto/mechanic-queue-item.dto';
import type { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';

export const QUEUE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

/** Task statuses that remain visible even when scheduled for a previous day. */
export const ACTIVE_OR_BLOCKED_STATUSES: WorkshopTaskStatus[] = [
  WorkshopTaskStatus.IN_PROGRESS,
  WorkshopTaskStatus.WAITING_PARTS,
  WorkshopTaskStatus.WAITING_CUSTOMER,
  WorkshopTaskStatus.PAUSED,
];

/** Part-line statuses that the mechanic view exposes (no financial context). */
export const VISIBLE_PART_LINE_STATUSES: WorkshopPartLineExecutionStatus[] = [
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
export function buildScheduledDateFilter(
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

export type RawQueueTaskRecord = {
  id: string;
  title: string;
  status: WorkshopTaskStatus;
  sequence: number;
  scheduled_date: Date | null;
  updatedAt: Date;
  workshop_order: {
    id: string;
    order_number: string;
    reported_issue: string | null;
    vehicle: {
      id: string;
      make: string;
      model: string;
      year: number;
      plate: string | null;
    };
  };
  bay: { id: string; name: string } | null;
  line_items: Array<{
    id: string;
    description: string;
    quantity: Prisma.Decimal | number;
    part_execution_status: WorkshopPartLineExecutionStatus | null;
  }>;
};

export type RawTaskDetailRecord = {
  id: string;
  title: string;
  status: WorkshopTaskStatus;
  mechanic_notes: string | null;
  sequence: number;
  scheduled_date: Date | null;
  createdAt: Date;
  updatedAt: Date;
  workshop_order: {
    id: string;
    order_number: string;
    reported_issue: string | null;
    odometer: number;
    mechanic_id: string | null;
    bay_id: string | null;
    vehicle: {
      id: string;
      make: string;
      model: string;
      year: number;
      vin: string | null;
      plate: string | null;
    };
  };
  bay: { id: string; name: string } | null;
  mechanic_id: string | null;
  line_items: Array<{
    id: string;
    type: import('@prisma/client').WorkshopLineItemType;
    item_no: string;
    description: string;
    quantity: Prisma.Decimal | number;
    part_execution_status: WorkshopPartLineExecutionStatus | null;
  }>;
};

/**
 * Maps a raw Prisma workshop task record to MechanicQueueItemDto.
 */
export function mapToMechanicQueueItem(
  task: RawQueueTaskRecord,
): MechanicQueueItemDto {
  const order = task.workshop_order;
  const vehicle = order.vehicle;
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
      qty: Number(li.quantity),
      partExecutionStatus: li.part_execution_status ?? null,
    })),
    updatedAt: task.updatedAt,
  } satisfies MechanicQueueItemDto;
}

/**
 * Maps a raw Prisma workshop task record to MechanicTaskDetailDto.
 */
export function mapToMechanicTaskDetail(
  task: RawTaskDetailRecord,
): MechanicTaskDetailDto {
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
      itemNo: li.item_no,
      description: li.description,
      qty: Number(li.quantity),
      partExecutionStatus: li.part_execution_status ?? null,
    })),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  } satisfies MechanicTaskDetailDto;
}
