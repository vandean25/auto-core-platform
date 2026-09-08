import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util';

export type WorkshopOrderWithTasks = Prisma.WorkshopOrderGetPayload<{
  include: {
    customer: true;
    vehicle: true;
    tasks: {
      include: {
        line_items: true;
      };
    };
  };
}>;

export type WorkshopOrderWithRelations = WorkshopOrderWithTasks & {
  invoice?: { id: string; invoice_number: string | null } | null;
};

export function deriveOrderStatus(taskStatuses: WorkshopTaskStatus[]) {
  if (taskStatuses.length === 0) return WorkshopOrderStatus.INTAKE;
  if (taskStatuses.every((status) => status === WorkshopTaskStatus.DONE)) {
    return WorkshopOrderStatus.COMPLETED;
  }
  if (
    taskStatuses.every((status) => status === WorkshopTaskStatus.NOT_STARTED)
  ) {
    return WorkshopOrderStatus.INTAKE;
  }
  return WorkshopOrderStatus.IN_PROGRESS;
}

export function assertOrderEditable(order: {
  status: WorkshopOrderStatus;
  purpose?: WorkshopOrderPurpose | null;
}) {
  if (order.status === WorkshopOrderStatus.INVOICED) {
    throw new BadRequestException('Workshop order is already invoiced');
  }
  if (
    order.purpose === WorkshopOrderPurpose.STOCK_PREP &&
    order.status === WorkshopOrderStatus.COMPLETED
  ) {
    throw new BadRequestException(
      'Completed stock-prep orders cannot be edited',
    );
  }
}

export function normalizeWorkshopOrder(order: WorkshopOrderWithRelations) {
  return {
    ...order,
    vehicle: order.vehicle
      ? stripVehicleIdentityResolutionState(order.vehicle)
      : order.vehicle,
    tasks:
      order.tasks?.map((task) => ({
        ...task,
        lineItemsVersion: task.line_items_version,
        done: task.status === WorkshopTaskStatus.DONE,
        lineItems:
          task.line_items?.map((line) => ({
            id: line.id,
            type: line.type,
            itemNo: line.item_no,
            description: line.description,
            qty: Number(line.quantity),
            unitPrice: Number(line.unit_price),
            partExecutionStatus: line.part_execution_status,
            laborOperationId: line.labor_operation_id,
            standardAw:
              line.standard_aw != null ? Number(line.standard_aw) : null,
            actualHours:
              line.actual_hours != null ? Number(line.actual_hours) : null,
            internalCostRate:
              line.internal_cost_rate != null
                ? Number(line.internal_cost_rate)
                : null,
          })) ?? [],
      })) ?? [],
  };
}
