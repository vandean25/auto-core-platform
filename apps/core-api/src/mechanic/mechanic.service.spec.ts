import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkshopOrderStatus, WorkshopTaskStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { MechanicService } from './mechanic.service';

const TENANT_ID = 'tenant-1';
const MECHANIC_ID = 'mechanic-employee-1';
const TASK_ID = 'task-1';
const ORDER_ID = 'order-1';

const mockPrisma = {
  employee: { findFirst: jest.fn() },
  workshopTask: { findFirst: jest.fn(), findMany: jest.fn() },
} as unknown as PrismaService;

const mockTenantContext = {
  getAuthenticatedUser: jest.fn(),
  getRequiredTenantId: jest.fn().mockReturnValue(TENANT_ID),
} as unknown as TenantContextService;

describe('MechanicService', () => {
  let service: MechanicService;

  beforeEach(() => {
    service = new MechanicService(mockPrisma, mockTenantContext);
    jest.clearAllMocks();
    (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue({
      userId: 'user-1',
      email: 'tech@workshop.at',
      tenantId: TENANT_ID,
      role: 'TECH',
    });
    (mockTenantContext.getRequiredTenantId as jest.Mock).mockReturnValue(
      TENANT_ID,
    );
  });

  // ─── assertMechanicAccess ────────────────────────────────────────────────

  describe('assertMechanicAccess()', () => {
    it('throws ForbiddenException when authenticated user is not TECH', async () => {
      (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'advisor@workshop.at',
        tenantId: TENANT_ID,
        role: 'SALES',
      });

      await expect(
        service.assertMechanicAccess(MECHANIC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when there is no authenticated user', async () => {
      (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue(
        undefined,
      );

      await expect(
        service.assertMechanicAccess(MECHANIC_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when employee not found in tenant', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.assertMechanicAccess(MECHANIC_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('passes when user is TECH and employee exists', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue({
        id: MECHANIC_ID,
      });

      await expect(
        service.assertMechanicAccess(MECHANIC_ID),
      ).resolves.toBeUndefined();
    });

    it('queries employee with tenant isolation and MECHANIC role filter', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue({
        id: MECHANIC_ID,
      });

      await service.assertMechanicAccess(MECHANIC_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          id: MECHANIC_ID,
          tenant_id: TENANT_ID,
          role: 'MECHANIC',
          is_active: true,
        },
        select: { id: true },
      });
    });
  });

  // ─── getMechanicQueue ────────────────────────────────────────────────────

  describe('getMechanicQueue()', () => {
    const makeTask = (overrides: Record<string, unknown> = {}) => ({
      id: TASK_ID,
      title: 'Oil change',
      status: WorkshopTaskStatus.NOT_STARTED,
      mechanic_notes: null,
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      sequence: 1,
      scheduled_date: null,
      createdAt: new Date('2026-01-01T08:00:00Z'),
      updatedAt: new Date('2026-01-01T09:00:00Z'),
      workshop_order: {
        id: ORDER_ID,
        order_number: 'WO-2026-0001',
        status: WorkshopOrderStatus.INTAKE,
        mechanic_id: null,
        bay_id: null,
        reported_issue: 'Check engine light',
        vehicle: {
          id: 'vehicle-1',
          make: 'VW',
          model: 'Golf',
          year: 2020,
          plate: 'W-TEST-1',
        },
      },
      bay: null,
      line_items: [],
      ...overrides,
    });

    it('returns mapped queue items from findMany result', async () => {
      (mockPrisma.workshopTask.findMany as jest.Mock).mockResolvedValue([
        makeTask(),
      ]);

      const result = await service.getMechanicQueue(MECHANIC_ID);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        taskId: TASK_ID,
        taskTitle: 'Oil change',
        taskStatus: WorkshopTaskStatus.NOT_STARTED,
        orderId: ORDER_ID,
        orderNumber: 'WO-2026-0001',
        reportedComplaint: 'Check engine light',
        vehicle: {
          id: 'vehicle-1',
          make: 'VW',
          model: 'Golf',
          year: 2020,
          plate: 'W-TEST-1',
        },
        bay: null,
        sequence: 1,
        scheduledDate: null,
        partLines: [],
      });
    });

    it('returns empty array when no tasks match', async () => {
      (mockPrisma.workshopTask.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getMechanicQueue(MECHANIC_ID);

      expect(result).toEqual([]);
    });

    it('scopes query to tenant_id and excludes DONE tasks', async () => {
      (mockPrisma.workshopTask.findMany as jest.Mock).mockResolvedValue([]);

      await service.getMechanicQueue(MECHANIC_ID);

      const call = (mockPrisma.workshopTask.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.where.tenant_id).toBe(TENANT_ID);
      expect(call.where.status).toEqual({
        not: WorkshopTaskStatus.DONE,
      });
    });

    it('includes vehicle via workshop_order and line_items in the query', async () => {
      (mockPrisma.workshopTask.findMany as jest.Mock).mockResolvedValue([]);

      await service.getMechanicQueue(MECHANIC_ID);

      const call = (mockPrisma.workshopTask.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.include.workshop_order).toBeDefined();
      expect(call.include.workshop_order.include.vehicle).toBeDefined();
      expect(call.include.line_items).toBeDefined();
    });

    it('does not expose customer PII fields in the response', async () => {
      (mockPrisma.workshopTask.findMany as jest.Mock).mockResolvedValue([
        makeTask(),
      ]);

      const result = await service.getMechanicQueue(MECHANIC_ID);
      const item = result[0] as Record<string, unknown>;

      expect(item).not.toHaveProperty('customer');
      expect(item).not.toHaveProperty('email');
      expect(item).not.toHaveProperty('phone');
      expect(item).not.toHaveProperty('address_street');
    });

    it('does not expose financial fields in the response', async () => {
      (mockPrisma.workshopTask.findMany as jest.Mock).mockResolvedValue([
        makeTask(),
      ]);

      const result = await service.getMechanicQueue(MECHANIC_ID);
      const item = result[0] as Record<string, unknown>;

      expect(item).not.toHaveProperty('unitPrice');
      expect(item).not.toHaveProperty('internalCostRate');
      expect(item).not.toHaveProperty('standardAw');
      expect(item).not.toHaveProperty('invoice');
    });

    it('formats scheduled_date as ISO date string', async () => {
      (mockPrisma.workshopTask.findMany as jest.Mock).mockResolvedValue([
        makeTask({
          scheduled_date: new Date('2026-04-28T00:00:00.000Z'),
        }),
      ]);

      const result = await service.getMechanicQueue(MECHANIC_ID);

      expect(result[0].scheduledDate).toBe('2026-04-28');
    });
  });

  // ─── getMechanicTaskDetail ───────────────────────────────────────────────

  describe('getMechanicTaskDetail()', () => {
    const makeFullTask = (overrides: Record<string, unknown> = {}) => ({
      id: TASK_ID,
      title: 'Brake service',
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_notes: 'Front pads worn',
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      sequence: 2,
      scheduled_date: null,
      createdAt: new Date('2026-01-01T08:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
      workshop_order: {
        id: ORDER_ID,
        order_number: 'WO-2026-0002',
        status: WorkshopOrderStatus.IN_PROGRESS,
        mechanic_id: null,
        bay_id: null,
        reported_issue: 'Squeaking noise',
        odometer: 75000,
        vehicle: {
          id: 'vehicle-2',
          make: 'BMW',
          model: 'X3',
          year: 2021,
          vin: 'ABC123',
          plate: 'W-BMW-1',
        },
      },
      bay: null,
      line_items: [],
      ...overrides,
    });

    it('throws NotFoundException when task does not exist', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getMechanicTaskDetail(MECHANIC_ID, TASK_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when task is not assigned to mechanic', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeFullTask({ mechanic_id: 'other-mechanic', workshop_order: {
          id: ORDER_ID,
          order_number: 'WO-2026-0002',
          status: WorkshopOrderStatus.IN_PROGRESS,
          mechanic_id: 'other-mechanic',
          bay_id: null,
          reported_issue: null,
          odometer: 0,
          vehicle: { id: 'v1', make: 'VW', model: 'Golf', year: 2020, vin: null, plate: null },
        } }),
      );

      await expect(
        service.getMechanicTaskDetail(MECHANIC_ID, TASK_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns task detail for task directly assigned to mechanic', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeFullTask(),
      );

      const result = await service.getMechanicTaskDetail(MECHANIC_ID, TASK_ID);

      expect(result.taskId).toBe(TASK_ID);
      expect(result.taskTitle).toBe('Brake service');
      expect(result.taskStatus).toBe(WorkshopTaskStatus.IN_PROGRESS);
      expect(result.mechanicNotes).toBe('Front pads worn');
      expect(result.odometer).toBe(75000);
    });

    it('returns task detail when task is inherited from order assignment', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeFullTask({
          mechanic_id: null,
          workshop_order: {
            id: ORDER_ID,
            order_number: 'WO-2026-0002',
            status: WorkshopOrderStatus.IN_PROGRESS,
            mechanic_id: MECHANIC_ID,
            bay_id: null,
            reported_issue: 'Squeaking noise',
            odometer: 75000,
            vehicle: {
              id: 'vehicle-2',
              make: 'BMW',
              model: 'X3',
              year: 2021,
              vin: 'ABC123',
              plate: 'W-BMW-1',
            },
          },
        }),
      );

      const result = await service.getMechanicTaskDetail(MECHANIC_ID, TASK_ID);

      expect(result.taskId).toBe(TASK_ID);
      expect(result.orderId).toBe(ORDER_ID);
    });

    it('scopes task lookup by tenant_id', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeFullTask(),
      );

      await service.getMechanicTaskDetail(MECHANIC_ID, TASK_ID);

      const call = (mockPrisma.workshopTask.findFirst as jest.Mock).mock
        .calls[0][0];
      expect(call.where.tenant_id).toBe(TENANT_ID);
      expect(call.where.id).toBe(TASK_ID);
    });

    it('does not expose customer PII in the response', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeFullTask(),
      );

      const result = await service.getMechanicTaskDetail(
        MECHANIC_ID,
        TASK_ID,
      );
      const item = result as Record<string, unknown>;

      expect(item).not.toHaveProperty('customer');
      expect(item).not.toHaveProperty('email');
      expect(item).not.toHaveProperty('phone');
    });

    it('does not expose financial fields in the response', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeFullTask(),
      );

      const result = await service.getMechanicTaskDetail(
        MECHANIC_ID,
        TASK_ID,
      );
      const item = result as Record<string, unknown>;

      expect(item).not.toHaveProperty('unitPrice');
      expect(item).not.toHaveProperty('internalCostRate');
      expect(item).not.toHaveProperty('invoice');
    });
  });
});
