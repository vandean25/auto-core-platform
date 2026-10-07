import { WorkshopInspectionService } from './workshop-inspection.service.js';

describe('WorkshopInspectionService', () => {
  it('loads only the requested task inspection inside the active tenant and site', async () => {
    const expected = { id: 'inspection-1', items: [] };
    const prisma = {
      workshopInspection: { findFirst: jest.fn().mockResolvedValue(expected) },
    } as any;
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    } as any;
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
    } as any;
    const service = new WorkshopInspectionService(
      prisma,
      tenantContext,
      siteContext,
    );

    await expect(service.getTaskChecklist('order-1', 'task-1')).resolves.toBe(
      expected,
    );
    expect(prisma.workshopInspection.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        workshop_order_id: 'order-1',
        workshop_task_id: 'task-1',
        workshop_order: { site_id: 'site-1' },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
  });

  it('updates only items belonging to the scoped inspection', async () => {
    const inspection = { id: 'inspection-1', tenant_id: 'tenant-1', items: [] };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue(inspection);
    const tx = {
      workshopOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 'order-1' }),
      },
      workshopInspectionItem: { updateMany },
    };
    const prisma = {
      workshopInspection: { findFirst },
      workshopInspectionItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 'item-1' }]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as any;
    const service = new WorkshopInspectionService(
      prisma,
      { getTenantId: jest.fn().mockResolvedValue('tenant-1') } as any,
      { getSiteId: jest.fn().mockResolvedValue('site-1') } as any,
    );

    await service.updateTaskChecklist('order-1', 'task-1', {
      items: [{ id: 'item-1', passed: false, notes: 'Needs attention' }],
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'item-1',
        tenant_id: 'tenant-1',
        workshop_inspection_id: 'inspection-1',
      },
      data: { passed: false, notes: 'Needs attention' },
    });
    expect(tx.workshopOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', tenant_id: 'tenant-1', site_id: 'site-1' },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('rejects a site retarget before writing checklist items', async () => {
    const updateMany = jest.fn();
    const prisma = {
      workshopInspection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'inspection-1',
          tenant_id: 'tenant-1',
          items: [],
        }),
      },
      workshopInspectionItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 'item-1' }]),
      },
      $transaction: jest.fn((callback) =>
        callback({
          workshopOrder: { findFirst: jest.fn().mockResolvedValue(null) },
          workshopInspectionItem: { updateMany },
        }),
      ),
    } as any;
    const service = new WorkshopInspectionService(
      prisma,
      { getTenantId: jest.fn().mockResolvedValue('tenant-1') } as any,
      { getSiteId: jest.fn().mockResolvedValue('site-1') } as any,
    );

    await expect(
      service.updateTaskChecklist('order-1', 'task-1', {
        items: [{ id: 'item-1', passed: true }],
      }),
    ).rejects.toThrow('Workshop order is outside the active site.');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects checklist items outside the scoped inspection', async () => {
    const prisma = {
      workshopInspection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'inspection-1',
          tenant_id: 'tenant-1',
          items: [],
        }),
      },
      workshopInspectionItem: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new WorkshopInspectionService(
      prisma,
      { getTenantId: jest.fn().mockResolvedValue('tenant-1') } as any,
      { getSiteId: jest.fn().mockResolvedValue('site-1') } as any,
    );

    await expect(
      service.updateTaskChecklist('order-1', 'task-1', {
        items: [{ id: 'foreign-item', passed: true }],
      }),
    ).rejects.toThrow('One or more checklist items are invalid.');
  });
});
