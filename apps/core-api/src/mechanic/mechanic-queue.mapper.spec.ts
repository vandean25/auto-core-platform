import {
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import {
  ACTIVE_OR_BLOCKED_STATUSES,
  buildScheduledDateFilter,
  mapToMechanicQueueItem,
  mapToMechanicTaskDetail,
} from './mechanic-queue.mapper';

describe('mechanic-queue.mapper', () => {
  it('builds scheduled date filter correctly', () => {
    const today = new Date('2026-09-10T00:00:00Z');
    const filter = buildScheduledDateFilter(today, ACTIVE_OR_BLOCKED_STATUSES);
    expect(filter.OR).toEqual([
      { scheduled_date: null },
      { scheduled_date: today },
      {
        scheduled_date: { lt: today },
        status: { in: ACTIVE_OR_BLOCKED_STATUSES },
      },
    ]);
  });

  it('maps queue item correctly', () => {
    const raw = {
      id: 'task-1',
      title: 'Brake inspection',
      status: WorkshopTaskStatus.NOT_STARTED,
      sequence: 1,
      scheduled_date: new Date('2026-09-10T00:00:00Z'),
      updatedAt: new Date('2026-09-10T08:00:00Z'),
      workshop_order: {
        id: 'order-1',
        order_number: 'WO-101',
        reported_issue: 'Squeaking sound',
        vehicle: {
          id: 'v-1',
          make: 'Audi',
          model: 'A4',
          year: 2021,
          plate: 'W-1234',
        },
      },
      bay: { id: 'bay-1', name: 'Bay 1' },
      line_items: [
        {
          id: 'li-1',
          description: 'Brake pads',
          quantity: 2,
          part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
        },
      ],
    };

    const mapped = mapToMechanicQueueItem(raw);
    expect(mapped).toEqual({
      taskId: 'task-1',
      taskTitle: 'Brake inspection',
      taskStatus: WorkshopTaskStatus.NOT_STARTED,
      orderId: 'order-1',
      orderNumber: 'WO-101',
      reportedComplaint: 'Squeaking sound',
      vehicle: {
        id: 'v-1',
        make: 'Audi',
        model: 'A4',
        year: 2021,
        plate: 'W-1234',
      },
      bay: { id: 'bay-1', name: 'Bay 1' },
      sequence: 1,
      scheduledDate: '2026-09-10',
      partLines: [
        {
          id: 'li-1',
          description: 'Brake pads',
          qty: 2,
          partExecutionStatus: WorkshopPartLineExecutionStatus.PENDING_PICK,
        },
      ],
      updatedAt: raw.updatedAt,
    });
  });

  it('maps task detail correctly', () => {
    const raw = {
      id: 'task-1',
      title: 'Oil service',
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_notes: 'Done oil filter replacement',
      sequence: 2,
      scheduled_date: null,
      createdAt: new Date('2026-09-10T07:00:00Z'),
      updatedAt: new Date('2026-09-10T08:00:00Z'),
      workshop_order: {
        id: 'order-1',
        order_number: 'WO-102',
        reported_issue: 'Routine maintenance',
        odometer: 45000,
        mechanic_id: 'tech-1',
        bay_id: null,
        vehicle: {
          id: 'v-2',
          make: 'BMW',
          model: '320d',
          year: 2022,
          vin: 'WBA123',
          plate: 'W-5678',
        },
      },
      bay: null,
      mechanic_id: 'tech-1',
      line_items: [
        {
          id: 'li-2',
          type: WorkshopLineItemType.LABOR,
          description: 'Oil drain and fill',
          quantity: 1,
          part_execution_status: null,
        },
      ],
    };

    const mapped = mapToMechanicTaskDetail(raw);
    expect(mapped).toEqual({
      taskId: 'task-1',
      taskTitle: 'Oil service',
      taskStatus: WorkshopTaskStatus.IN_PROGRESS,
      mechanicNotes: 'Done oil filter replacement',
      orderId: 'order-1',
      orderNumber: 'WO-102',
      reportedComplaint: 'Routine maintenance',
      odometer: 45000,
      vehicle: {
        id: 'v-2',
        make: 'BMW',
        model: '320d',
        year: 2022,
        vin: 'WBA123',
        plate: 'W-5678',
      },
      bay: null,
      sequence: 2,
      scheduledDate: null,
      lineItems: [
        {
          id: 'li-2',
          type: WorkshopLineItemType.LABOR,
          description: 'Oil drain and fill',
          qty: 1,
          partExecutionStatus: null,
        },
      ],
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  });
});
