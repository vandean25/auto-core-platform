import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LaborPauseReason,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { MechanicExecutionService } from './mechanic-execution.service';
import { TASK_WAITING_CUSTOMER_EVENT } from './mechanic-events.constants';
import {
  MECHANIC_ID,
  ORDER_ID,
  TASK_ID,
  TENANT_ID,
  mockEventEmitter,
  mockPrisma,
  mockRealtimeService,
  mockTenantContext,
  mockVehicleLedger,
} from './mechanic.spec.support';

describe('MechanicExecutionService', () => {
  let service: MechanicExecutionService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.WORKSHOP_MEDIA_BUCKET = 'workshop-media-bucket';
    service = new MechanicExecutionService(
      mockPrisma,
      mockTenantContext,
      mockRealtimeService,
      mockEventEmitter,
      mockVehicleLedger,
    );
    (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue({
      userId: 'user-1',
      email: 'tech@workshop.at',
      tenantId: TENANT_ID,
      role: 'TECH',
    });
    (mockTenantContext.getTenantId as jest.Mock).mockResolvedValue(TENANT_ID);
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
    );
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
        makeFullTask({
          mechanic_id: 'other-mechanic',
          workshop_order: {
            id: ORDER_ID,
            order_number: 'WO-2026-0002',
            status: WorkshopOrderStatus.IN_PROGRESS,
            mechanic_id: 'other-mechanic',
            bay_id: null,
            reported_issue: null,
            odometer: 0,
            vehicle: {
              id: 'v1',
              make: 'VW',
              model: 'Golf',
              year: 2020,
              vin: null,
              plate: null,
            },
          },
        }),
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

      const result = await service.getMechanicTaskDetail(MECHANIC_ID, TASK_ID);
      const item = result as Record<string, unknown>;

      expect(item).not.toHaveProperty('customer');
      expect(item).not.toHaveProperty('email');
      expect(item).not.toHaveProperty('phone');
    });

    it('does not expose financial fields in the response', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeFullTask(),
      );

      const result = await service.getMechanicTaskDetail(MECHANIC_ID, TASK_ID);
      const item = result as Record<string, unknown>;

      expect(item).not.toHaveProperty('unitPrice');
      expect(item).not.toHaveProperty('internalCostRate');
      expect(item).not.toHaveProperty('invoice');
    });
  });

  // ─── startTask ──────────────────────────────────────────────────────────

  describe('startTask()', () => {
    const makeStartableTask = (overrides: Record<string, unknown> = {}) => ({
      id: TASK_ID,
      title: 'Oil change',
      status: WorkshopTaskStatus.NOT_STARTED,
      mechanic_notes: null,
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      sequence: 1,
      scheduled_date: null,
      workshop_order_id: ORDER_ID,
      createdAt: new Date('2026-01-01T08:00:00Z'),
      updatedAt: new Date('2026-01-01T09:00:00Z'),
      workshop_order: {
        id: ORDER_ID,
        order_number: 'WO-2026-0001',
        status: WorkshopOrderStatus.INTAKE,
        mechanic_id: null,
        bay_id: null,
        reported_issue: null,
        odometer: 50000,
        vehicle: {
          id: 'v1',
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: null,
          plate: null,
        },
      },
      bay: null,
      line_items: [],
      ...overrides,
    });

    it('throws NotFoundException when task does not exist', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.startTask(MECHANIC_ID, TASK_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws UnprocessableEntityException when task is DONE', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeStartableTask({ status: WorkshopTaskStatus.DONE }),
      );

      await expect(service.startTask(MECHANIC_ID, TASK_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('throws UnprocessableEntityException when task already has an active labor entry', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeStartableTask(),
      );
      // First findFirst (task-scoped) returns an active entry → 422
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'open-entry',
      });

      await expect(service.startTask(MECHANIC_ID, TASK_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('throws ConflictException when mechanic already has an open labor entry on a different task', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeStartableTask(),
      );
      // First findFirst (task-scoped) returns null, second (mechanic-scoped) returns entry → 409
      (mockPrisma.laborEntry.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing-entry' });

      await expect(service.startTask(MECHANIC_ID, TASK_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates labor entry and transitions task when no open entry exists', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeStartableTask())
        // second call from getMechanicTaskDetail inside startTask
        .mockResolvedValueOnce(
          makeStartableTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        );
      // Both findFirst calls return null (no existing entries)
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.laborEntry.create as jest.Mock).mockResolvedValue({
        id: 'new-entry',
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.startTask(MECHANIC_ID, TASK_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('allows resuming an IN_PROGRESS task when no open labor entry exists for it', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(
          makeStartableTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        )
        .mockResolvedValueOnce(
          makeStartableTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        );
      // Both findFirst calls return null
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.laborEntry.create as jest.Mock).mockResolvedValue({
        id: 'resume-entry',
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 0 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      // Should not throw — IN_PROGRESS with no open entry is a resumable task
      await expect(
        service.startTask(MECHANIC_ID, TASK_ID),
      ).resolves.not.toThrow();
    });

    it('emits WORKSHOP_TASK realtime update after start', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeStartableTask())
        .mockResolvedValueOnce(
          makeStartableTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.laborEntry.create as jest.Mock).mockResolvedValue({
        id: 'new-entry',
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.startTask(MECHANIC_ID, TASK_ID);

      expect(mockRealtimeService.emitEntityUpdated).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ type: 'WORKSHOP_TASK', entityId: TASK_ID }),
      );
    });
  });

  // ─── switchTask ─────────────────────────────────────────────────────────

  describe('switchTask()', () => {
    const PREV_TASK_ID = 'prev-task-1';
    const makeTargetTask = (overrides: Record<string, unknown> = {}) => ({
      id: TASK_ID,
      title: 'Brake service',
      status: WorkshopTaskStatus.NOT_STARTED,
      mechanic_notes: null,
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      sequence: 2,
      scheduled_date: null,
      workshop_order_id: ORDER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
      workshop_order: {
        id: ORDER_ID,
        order_number: 'WO-2026-0001',
        status: WorkshopOrderStatus.IN_PROGRESS,
        mechanic_id: null,
        bay_id: null,
        reported_issue: null,
        odometer: 50000,
        vehicle: {
          id: 'v1',
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: null,
          plate: null,
        },
      },
      bay: null,
      line_items: [],
      ...overrides,
    });

    /** Shared open-entry mock (second laborEntry.findFirst call: mechanic-scoped). */
    const openEntryMock = {
      id: 'open-entry-1',
      workshop_task_id: PREV_TASK_ID,
      workshop_task: { workshop_order_id: 'prev-order-1' },
    };

    it('throws NotFoundException when target task does not exist', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.switchTask(MECHANIC_ID, TASK_ID, {
          previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when target task already has an active labor entry', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTargetTask(),
      );
      // First findFirst (target-scoped) returns an active entry → 422
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'target-entry',
      });

      await expect(
        service.switchTask(MECHANIC_ID, TASK_ID, {
          previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws ConflictException when mechanic has no open labor entry', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTargetTask(),
      );
      // First findFirst (target-scoped): null; second (mechanic-scoped): null → 409
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.switchTask(MECHANIC_ID, TASK_ID, {
          previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('executes the full atomic transaction on valid switch', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTargetTask())
        .mockResolvedValueOnce(
          makeTargetTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        );
      // First findFirst (target-scoped): null; second (mechanic-scoped): open entry
      (mockPrisma.laborEntry.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(openEntryMock);
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (mockPrisma.laborEntry.create as jest.Mock).mockResolvedValue({
        id: 'new-entry',
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.switchTask(MECHANIC_ID, TASK_ID, {
        previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('allows switching to an IN_PROGRESS target with no active labor entry', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(
          makeTargetTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        )
        .mockResolvedValueOnce(
          makeTargetTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // target has no active entry
        .mockResolvedValueOnce(openEntryMock); // mechanic has open entry to switch from
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (mockPrisma.laborEntry.create as jest.Mock).mockResolvedValue({
        id: 'new-entry',
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      // Should not throw — IN_PROGRESS target with no active entry is resumable
      await expect(
        service.switchTask(MECHANIC_ID, TASK_ID, {
          previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
        }),
      ).resolves.not.toThrow();
    });

    it('emits realtime updates for both previous and target tasks', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTargetTask())
        .mockResolvedValueOnce(
          makeTargetTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(openEntryMock);
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (mockPrisma.laborEntry.create as jest.Mock).mockResolvedValue({
        id: 'new-entry',
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.switchTask(MECHANIC_ID, TASK_ID, {
        previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
      });

      expect(mockRealtimeService.emitEntityUpdated).toHaveBeenCalledTimes(2);
      expect(mockRealtimeService.emitEntityUpdated).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          type: 'WORKSHOP_TASK',
          entityId: PREV_TASK_ID,
        }),
      );
      expect(mockRealtimeService.emitEntityUpdated).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ type: 'WORKSHOP_TASK', entityId: TASK_ID }),
      );
    });

    it('emits WAITING_CUSTOMER event when previous pause reason is WAITING_CUSTOMER', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTargetTask())
        .mockResolvedValueOnce(
          makeTargetTask({ status: WorkshopTaskStatus.IN_PROGRESS }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(openEntryMock);
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (mockPrisma.laborEntry.create as jest.Mock).mockResolvedValue({
        id: 'new-entry',
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.switchTask(MECHANIC_ID, TASK_ID, {
        previousPauseReason: LaborPauseReason.WAITING_CUSTOMER,
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        TASK_WAITING_CUSTOMER_EVENT,
        expect.objectContaining({
          tenantId: TENANT_ID,
          taskId: PREV_TASK_ID,
          orderId: 'prev-order-1',
        }),
      );
    });
  });

  // ─── pauseTask ──────────────────────────────────────────────────────────

  describe('pauseTask()', () => {
    const makePausableTask = (overrides: Record<string, unknown> = {}) => ({
      id: TASK_ID,
      title: 'Brake service',
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_notes: null,
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      sequence: 1,
      scheduled_date: null,
      workshop_order_id: ORDER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
      workshop_order: {
        id: ORDER_ID,
        order_number: 'WO-2026-0001',
        status: WorkshopOrderStatus.IN_PROGRESS,
        mechanic_id: null,
        bay_id: null,
        reported_issue: null,
        odometer: 50000,
        vehicle: {
          id: 'v1',
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: null,
          plate: null,
        },
      },
      bay: null,
      line_items: [],
      ...overrides,
    });

    it('throws NotFoundException when task does not exist', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.pauseTask(MECHANIC_ID, TASK_ID, {
          pauseReason: LaborPauseReason.OTHER,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when no open labor entry exists for the task', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makePausableTask(),
      );
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.pauseTask(MECHANIC_ID, TASK_ID, {
          pauseReason: LaborPauseReason.OTHER,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('closes labor entry and transitions task status on valid pause', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makePausableTask())
        .mockResolvedValueOnce(
          makePausableTask({ status: WorkshopTaskStatus.WAITING_PARTS }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue({
        id: 'open-entry-1',
      });
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.pauseTask(MECHANIC_ID, TASK_ID, {
        pauseReason: LaborPauseReason.WAITING_PARTS,
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('emits WAITING_CUSTOMER event when pause reason is WAITING_CUSTOMER', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makePausableTask())
        .mockResolvedValueOnce(
          makePausableTask({ status: WorkshopTaskStatus.WAITING_CUSTOMER }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue({
        id: 'open-entry-1',
      });
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.pauseTask(MECHANIC_ID, TASK_ID, {
        pauseReason: LaborPauseReason.WAITING_CUSTOMER,
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        TASK_WAITING_CUSTOMER_EVENT,
        expect.objectContaining({
          tenantId: TENANT_ID,
          taskId: TASK_ID,
          mechanicId: MECHANIC_ID,
        }),
      );
    });

    it('does not emit WAITING_CUSTOMER event for OTHER pause reason', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makePausableTask())
        .mockResolvedValueOnce(makePausableTask());
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue({
        id: 'open-entry-1',
      });
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });

      await service.pauseTask(MECHANIC_ID, TASK_ID, {
        pauseReason: LaborPauseReason.OTHER,
      });

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // ─── completeTask ────────────────────────────────────────────────────────

  describe('completeTask()', () => {
    const makeCompletableTask = (overrides: Record<string, unknown> = {}) => ({
      id: TASK_ID,
      title: 'Oil change',
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_notes: null,
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      sequence: 1,
      scheduled_date: null,
      workshop_order_id: ORDER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
      workshop_order: {
        id: ORDER_ID,
        order_number: 'WO-2026-0001',
        status: WorkshopOrderStatus.IN_PROGRESS,
        mechanic_id: null,
        bay_id: null,
        reported_issue: null,
        odometer: 50000,
        vehicle: {
          id: 'v1',
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: null,
          plate: null,
        },
        tasks: [{ id: TASK_ID, status: WorkshopTaskStatus.IN_PROGRESS }],
      },
      bay: null,
      line_items: [],
      ...overrides,
    });

    it('throws NotFoundException when task does not exist', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.completeTask(MECHANIC_ID, TASK_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws UnprocessableEntityException when task is already DONE', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeCompletableTask({ status: WorkshopTaskStatus.DONE }),
      );

      await expect(service.completeTask(MECHANIC_ID, TASK_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('transitions task to DONE and closes open labor entry', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeCompletableTask())
        .mockResolvedValueOnce(
          makeCompletableTask({ status: WorkshopTaskStatus.DONE }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue({
        id: 'open-entry-1',
      });
      (mockPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await service.completeTask(MECHANIC_ID, TASK_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('completes task without error when no open labor entry exists', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeCompletableTask())
        .mockResolvedValueOnce(
          makeCompletableTask({ status: WorkshopTaskStatus.DONE }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await service.completeTask(MECHANIC_ID, TASK_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('emits WORKSHOP_TASK realtime update after completion', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeCompletableTask())
        .mockResolvedValueOnce(
          makeCompletableTask({ status: WorkshopTaskStatus.DONE }),
        );
      (mockPrisma.laborEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (
        mockPrisma.workshopTask as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (
        mockPrisma.workshopOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await service.completeTask(MECHANIC_ID, TASK_ID);

      expect(mockRealtimeService.emitEntityUpdated).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ type: 'WORKSHOP_TASK', entityId: TASK_ID }),
      );
    });
  });

  // ─── saveDiagnostics ───────────────────────────────────────────────────────

  describe('saveDiagnostics()', () => {
    const makeTaskForDiagnostics = (overrides = {}) => ({
      id: TASK_ID,
      mechanic_id: MECHANIC_ID,
      mechanic_notes: null,
      workshop_order: { mechanic_id: MECHANIC_ID, bay_id: null },
      ...overrides,
    });

    it('throws NotFoundException when task is not found', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.saveDiagnostics(MECHANIC_ID, TASK_ID, {
          mechanicNotes: 'note',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('saves mechanicNotes when provided', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTaskForDiagnostics())
        .mockResolvedValueOnce({ id: TASK_ID, mechanic_notes: 'Oil leak.' });
      (mockPrisma.workshopTask.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.saveDiagnostics(MECHANIC_ID, TASK_ID, {
        mechanicNotes: 'Oil leak.',
      });

      expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TASK_ID, tenant_id: TENANT_ID },
          data: { mechanic_notes: 'Oil leak.' },
        }),
      );
      expect(result.mechanicNotes).toBe('Oil leak.');
    });

    it('does not update mechanicNotes when field is absent from dto', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTaskForDiagnostics())
        .mockResolvedValueOnce({ id: TASK_ID, mechanic_notes: null });

      await service.saveDiagnostics(MECHANIC_ID, TASK_ID, {});

      expect(mockPrisma.workshopTask.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when inspectionId not found for task', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForDiagnostics(),
      );
      (mockPrisma.workshopInspection.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.saveDiagnostics(MECHANIC_ID, TASK_ID, {
          inspectionId: 'insp-1',
          inspectionItems: [{ itemId: 'item-1', passed: true }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts a pending voice-note draft and applies translated text when mechanicNotes is omitted', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTaskForDiagnostics())
        .mockResolvedValueOnce({
          id: TASK_ID,
          mechanic_notes: 'Translated diagnostic note',
        });
      (
        mockPrisma.workshopVoiceNoteDraft.findFirst as jest.Mock
      ).mockResolvedValue({
        id: 'draft-1',
        translated_text: 'Translated diagnostic note',
      });
      (
        mockPrisma.workshopVoiceNoteDraft.updateMany as jest.Mock
      ).mockResolvedValue({
        count: 1,
      });
      (mockPrisma.workshopTask.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.saveDiagnostics(MECHANIC_ID, TASK_ID, {
        voiceNoteDraftId: 'draft-1',
      });

      expect(mockPrisma.workshopVoiceNoteDraft.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'draft-1', status: 'PENDING' }),
        }),
      );
      expect(result.mechanicNotes).toBe('Translated diagnostic note');
    });

    it('prefers explicit mechanicNotes over accepted draft text', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeTaskForDiagnostics())
        .mockResolvedValueOnce({
          id: TASK_ID,
          mechanic_notes: 'Explicit mechanic note',
        });
      (
        mockPrisma.workshopVoiceNoteDraft.findFirst as jest.Mock
      ).mockResolvedValue({
        id: 'draft-2',
        translated_text: 'Draft translated text',
      });
      (
        mockPrisma.workshopVoiceNoteDraft.updateMany as jest.Mock
      ).mockResolvedValue({
        count: 1,
      });
      (mockPrisma.workshopTask.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.saveDiagnostics(MECHANIC_ID, TASK_ID, {
        voiceNoteDraftId: 'draft-2',
        mechanicNotes: 'Explicit mechanic note',
      });

      expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mechanic_notes: 'Explicit mechanic note' },
        }),
      );
      expect(result.mechanicNotes).toBe('Explicit mechanic note');
    });

    it('throws NotFoundException when voiceNoteDraftId does not belong to mechanic/task', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForDiagnostics(),
      );
      (
        mockPrisma.workshopVoiceNoteDraft.findFirst as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.saveDiagnostics(MECHANIC_ID, TASK_ID, {
          voiceNoteDraftId: 'missing-draft',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when draft is already accepted before update', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForDiagnostics(),
      );
      (
        mockPrisma.workshopVoiceNoteDraft.findFirst as jest.Mock
      ).mockResolvedValue({
        id: 'draft-accepted',
        translated_text: 'Already accepted text',
      });
      (
        mockPrisma.workshopVoiceNoteDraft.updateMany as jest.Mock
      ).mockResolvedValue({
        count: 0,
      });

      await expect(
        service.saveDiagnostics(MECHANIC_ID, TASK_ID, {
          voiceNoteDraftId: 'draft-accepted',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── requestPart ──────────────────────────────────────────────────────────

  describe('requestPart()', () => {
    const makeTaskForPart = (overrides = {}) => ({
      id: TASK_ID,
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_id: MECHANIC_ID,
      workshop_order: { mechanic_id: MECHANIC_ID, bay_id: null },
      ...overrides,
    });

    it('throws NotFoundException when task not found', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.requestPart(MECHANIC_ID, TASK_ID, {
          itemNo: 'SKU-1',
          description: 'Part A',
          qty: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when task is DONE', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForPart({ status: WorkshopTaskStatus.DONE }),
      );

      await expect(
        service.requestPart(MECHANIC_ID, TASK_ID, {
          itemNo: 'SKU-1',
          description: 'Part A',
          qty: 1,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('creates PENDING_PICK line item and emits realtime event', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForPart(),
      );
      (mockPrisma.workshopTaskLineItem.create as jest.Mock).mockResolvedValue({
        id: 'line-1',
        item_no: 'OIL-5W30',
        description: '5W-30 Engine Oil',
        quantity: { toNumber: () => 2, toString: () => '2' },
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      });

      const result = await service.requestPart(MECHANIC_ID, TASK_ID, {
        itemNo: 'OIL-5W30',
        description: '5W-30 Engine Oil',
        qty: 2,
      });

      expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: TENANT_ID,
            workshop_task_id: TASK_ID,
            type: WorkshopLineItemType.PART,
            part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
            item_no: 'OIL-5W30',
          }),
        }),
      );
      expect(result.partExecutionStatus).toBe(
        WorkshopPartLineExecutionStatus.PENDING_PICK,
      );
      // The Prisma realtime extension emits the event; service no longer calls manually.
      expect(mockRealtimeService.emitEntityUpdated).not.toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          type: 'WORKSHOP_TASK_LINE_ITEM',
          action: 'CREATED',
        }),
      );
    });

    it('does not include vendor cost or part cost in created line item', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTaskForPart(),
      );
      (mockPrisma.workshopTaskLineItem.create as jest.Mock).mockResolvedValue({
        id: 'line-1',
        item_no: 'SKU-1',
        description: 'Part A',
        quantity: { toNumber: () => 1, toString: () => '1' },
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      });

      await service.requestPart(MECHANIC_ID, TASK_ID, {
        itemNo: 'SKU-1',
        description: 'Part A',
        qty: 1,
      });

      const createCall = (mockPrisma.workshopTaskLineItem.create as jest.Mock)
        .mock.calls[0][0];
      // Guardrail: internal_cost_rate and standard_aw must not be set by mechanic
      expect(createCall.data).not.toHaveProperty('internal_cost_rate');
      expect(createCall.data).not.toHaveProperty('standard_aw');
    });
  });
});
