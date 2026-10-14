import { NotFoundException } from '@nestjs/common';
import { WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import {
  attachPickerlTaskIfRequested,
  insertWorkshopOrder,
} from './workshop-intake-insert.helpers.js';
import { ORDER_WITH_RELATIONS } from './workshop-intake-query.helpers.js';
import { PICKERL_TASK_TITLE } from './workshop-pickerl.helpers.js';

const baseDto = {
  vehicleId: 'v-1',
  customerId: 'c-1',
  reportedIssue: 'Engine noise',
  notes: 'Urgent',
} as any;

function buildCreateTx() {
  return {
    workshopOrder: {
      create: jest.fn().mockResolvedValue({ id: 'wo-1' }),
    },
  } as any;
}

describe('insertWorkshopOrder', () => {
  it('starts an unbooked order at intake without a bay or slot', async () => {
    const tx = buildCreateTx();

    await insertWorkshopOrder({
      tx,
      tenantId: 'tenant-1',
      siteId: 'site-1',
      dto: baseDto,
      purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
      booked: null,
      orderNumber: 'WO-1',
    });

    const { data } = tx.workshopOrder.create.mock.calls[0][0];
    expect(data.status).toBe(WorkshopOrderStatus.INTAKE);
    expect(data.bay_id).toBeUndefined();
    expect(data.scheduled_start_at).toBeUndefined();
  });

  it('schedules a booked order into the reserved bay, mechanic and slot', async () => {
    const tx = buildCreateTx();
    const start = new Date('2026-10-20T08:00:00Z');
    const end = new Date('2026-10-20T10:00:00Z');

    await insertWorkshopOrder({
      tx,
      tenantId: 'tenant-1',
      siteId: 'site-1',
      dto: baseDto,
      purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
      booked: { bayId: 'bay-1', mechanicId: 'm-1', start, end },
      orderNumber: 'WO-1',
    });

    expect(tx.workshopOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: WorkshopOrderStatus.SCHEDULED,
        bay_id: 'bay-1',
        mechanic_id: 'm-1',
        scheduled_start_at: start,
        scheduled_end_at: end,
      }),
      include: ORDER_WITH_RELATIONS,
    });
  });

  it('stores no customer for stock-prep orders', async () => {
    const tx = buildCreateTx();

    await insertWorkshopOrder({
      tx,
      tenantId: 'tenant-1',
      siteId: 'site-1',
      dto: baseDto,
      purpose: WorkshopOrderPurpose.STOCK_PREP,
      booked: null,
      orderNumber: 'WO-1',
    });

    expect(
      tx.workshopOrder.create.mock.calls[0][0].data.customer_id,
    ).toBeNull();
  });

  it('defaults odometer and fuel level to zero when they are omitted', async () => {
    const tx = buildCreateTx();

    await insertWorkshopOrder({
      tx,
      tenantId: 'tenant-1',
      siteId: 'site-1',
      dto: { vehicleId: 'v-1' },
      purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
      booked: null,
      orderNumber: 'WO-1',
    });

    expect(tx.workshopOrder.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ odometer: 0, fuel_level: 0 }),
    );
  });
});

describe('attachPickerlTaskIfRequested', () => {
  const order = { id: 'wo-1' } as any;
  const reloaded = {
    id: 'wo-1',
    tasks: [{ title: PICKERL_TASK_TITLE }],
  } as any;

  it('returns the order untouched when no §57a task is requested', async () => {
    const tx = {} as any;

    await expect(
      attachPickerlTaskIfRequested(tx, 'tenant-1', 'site-1', order, false),
    ).resolves.toBe(order);
    await expect(
      attachPickerlTaskIfRequested(tx, 'tenant-1', 'site-1', order, undefined),
    ).resolves.toBe(order);
  });

  it('creates the §57a task from the active template and reloads the order', async () => {
    const tx = {
      inspectionTemplate: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'tpl-1', title: 'Checklist', items: [] }),
      },
      workshopTask: { create: jest.fn().mockResolvedValue({ id: 'task-1' }) },
      workshopInspection: { create: jest.fn().mockResolvedValue({}) },
      workshopOrder: {
        findFirstOrThrow: jest.fn().mockResolvedValue(reloaded),
      },
    } as any;

    await expect(
      attachPickerlTaskIfRequested(tx, 'tenant-1', 'site-1', order, true),
    ).resolves.toBe(reloaded);
    expect(tx.workshopTask.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        workshop_order_id: 'wo-1',
        title: PICKERL_TASK_TITLE,
      },
    });
    expect(tx.workshopOrder.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: 'wo-1', tenant_id: 'tenant-1', site_id: 'site-1' },
      include: ORDER_WITH_RELATIONS,
    });
  });

  it('fails without creating a partial task when the tenant has no §57a template', async () => {
    const tx = {
      inspectionTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      workshopTask: { create: jest.fn() },
    } as any;

    await expect(
      attachPickerlTaskIfRequested(tx, 'tenant-1', 'site-1', order, true),
    ).rejects.toThrow(NotFoundException);
    expect(tx.workshopTask.create).not.toHaveBeenCalled();
  });
});
