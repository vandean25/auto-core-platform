import {
  assertCanCreatePickerlOrder,
  createPickerlTaskAndInspection,
} from './workshop-pickerl.helpers.js';
import { executeCreateWorkshopOrder } from './workshop-intake.helpers.js';

describe('workshop-pickerl.helpers', () => {
  it('blocks TECH from creating Pickerl orders', () => {
    expect(() => assertCanCreatePickerlOrder('TECH')).toThrow(
      'Only OWNER, ADMIN, or SALES can create a §57a workshop order.',
    );
  });

  it('creates a §57a task and snapshots its tenant template labels', async () => {
    const template = {
      id: 'template-1',
      title: '§57a Vorbereitung',
      items: [
        { id: 'item-1', label: 'Beleuchtung', unit: null },
        { id: 'item-2', label: 'Bremsen', unit: null },
      ],
    };
    const workshopTaskCreate = jest.fn().mockResolvedValue({ id: 'task-1' });
    const workshopInspectionCreate = jest.fn().mockResolvedValue({
      id: 'inspection-1',
    });
    const tx: any = {
      inspectionTemplate: {
        findFirst: jest.fn().mockResolvedValue(template),
      },
      workshopTask: { create: workshopTaskCreate },
      workshopInspection: { create: workshopInspectionCreate },
    };

    await createPickerlTaskAndInspection(tx, 'tenant-1', 'order-1');

    expect(tx.inspectionTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        code: 'PICKERL_57A_PREP',
        version: 1,
        is_active: true,
      },
      include: {
        items: {
          where: { tenant_id: 'tenant-1', is_active: true },
          orderBy: { sort_order: 'asc' },
        },
      },
    });
    expect(workshopTaskCreate).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        workshop_order_id: 'order-1',
        title: '§57a Begutachtung',
      },
    });
    expect(workshopInspectionCreate).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        workshop_order_id: 'order-1',
        workshop_task_id: 'task-1',
        inspection_template_id: 'template-1',
        title: '§57a Vorbereitung',
        items: {
          create: [
            {
              inspection_template_item_id: 'item-1',
              label_snapshot: 'Beleuchtung',
              unit: null,
            },
            {
              inspection_template_item_id: 'item-2',
              label_snapshot: 'Bremsen',
              unit: null,
            },
          ],
        },
      },
    });
  });

  it('returns the existing open §57a order scoped to the active tenant and site', async () => {
    const existingOrder = { id: 'order-1', tasks: [{ title: '§57a Begutachtung' }] };
    const findFirst = jest.fn().mockResolvedValue(existingOrder);
    const services: any = {
      prisma: {
        vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'vehicle-1' }) },
        customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }) },
        workshopOrder: { findFirst },
      },
      tenantContext: {
        getTenantId: jest.fn().mockResolvedValue('tenant-1'),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'SALES' }),
      },
      siteContext: { getSiteId: jest.fn().mockResolvedValue('site-1') },
      scheduleService: {},
    };

    await expect(
      executeCreateWorkshopOrder(
        services,
        {
          customerId: 'customer-1',
          vehicleId: 'vehicle-1',
          odometer: 18000,
          fuelLevel: 50,
          createPickerlTask: true,
        },
        jest.fn(),
      ),
    ).resolves.toBe(existingOrder);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        vehicle_id: 'vehicle-1',
        status: { in: ['SCHEDULED', 'INTAKE', 'IN_PROGRESS'] },
        tasks: { some: { title: '§57a Begutachtung' } },
      },
      include: expect.any(Object),
    });
  });
});
