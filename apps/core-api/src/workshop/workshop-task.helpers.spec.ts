import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import {
  assertLineQuantityDemand,
  buildNewTaskLineItemRecord,
  buildTaskUpdateFieldData,
  classifyDeletedLineItems,
  computeFieldNameText,
  computePartItemExecutionStatus,
  derivePartExecutionStatusMap,
  executeExistingLineItemUpdates,
  executeLineDeletionsAndCancellations,
  fetchPartLineReservations,
  findLineReservationHistory,
  groupReservationsByLine,
  handleDeletedLineItems,
  handleTaskLineItemsError,
  lockWorkshopRows,
  releaseDeletedLineReservations,
  resolveDefaultTaskScheduledDate,
  resolveOrderStatusConflict,
  updateExistingTaskLineItems,
} from './workshop-task.helpers.js';

describe('workshop-task.helpers', () => {
  describe('computeFieldNameText', () => {
    it('returns string field name as-is', () => {
      expect(computeFieldNameText('labor_operation_id')).toBe(
        'labor_operation_id',
      );
    });

    it('joins array field names with commas', () => {
      expect(
        computeFieldNameText(['workshop_task_id', 'labor_operation_id']),
      ).toBe('workshop_task_id,labor_operation_id');
    });

    it('returns empty string for non-string, non-array inputs', () => {
      expect(computeFieldNameText(null)).toBe('');
      expect(computeFieldNameText(undefined)).toBe('');
      expect(computeFieldNameText(123)).toBe('');
    });
  });

  describe('handleTaskLineItemsError', () => {
    it('translates P2003 on labor_operation_id to BadRequestException', () => {
      const p2003Error = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        {
          code: 'P2003',
          clientVersion: '7.0.0',
          meta: { field_name: 'labor_operation_id' },
        },
      );

      expect(() => handleTaskLineItemsError(p2003Error)).toThrow(
        BadRequestException,
      );
      expect(() => handleTaskLineItemsError(p2003Error)).toThrow(
        'Invalid laborOperationId: referenced labor operation was not found',
      );
    });

    it('rethrows non-P2003 prisma error', () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '7.0.0',
        },
      );

      expect(() => handleTaskLineItemsError(p2002Error)).toThrow(p2002Error);
    });

    it('rethrows generic error unchanged', () => {
      const err = new Error('Database down');
      expect(() => handleTaskLineItemsError(err)).toThrow(err);
    });
  });

  describe('buildTaskUpdateFieldData', () => {
    it('builds mutation input with title and mechanic notes when present', () => {
      const result = buildTaskUpdateFieldData({
        title: 'New Title',
        mechanicNotes: 'New notes',
      });
      expect(result).toEqual({
        title: 'New Title',
        mechanic_notes: 'New notes',
      });
    });

    it('omits fields when undefined', () => {
      const result = buildTaskUpdateFieldData({});
      expect(result).toEqual({});
    });
  });

  describe('buildNewTaskLineItemRecord', () => {
    it('constructs a labor line item record with decimal values', () => {
      const record = buildNewTaskLineItemRecord('ten-1', 'task-1', {
        type: WorkshopLineItemType.LABOR,
        itemNo: 'LAB-01',
        description: 'Oil change labor',
        qty: 1,
        unitPrice: 50,
        laborOperationId: 'op-1',
        standardAw: 2,
        actualHours: 1.5,
        internalCostRate: 35,
      });

      expect(record.tenant_id).toBe('ten-1');
      expect(record.workshop_task_id).toBe('task-1');
      expect(record.type).toBe(WorkshopLineItemType.LABOR);
      expect(record.part_execution_status).toBeNull();
      expect(record.quantity).toEqual(new Prisma.Decimal(1));
      expect(record.unit_price).toEqual(new Prisma.Decimal(50));
      expect(record.labor_operation_id).toBe('op-1');
      expect(record.standard_aw).toEqual(new Prisma.Decimal(2));
      expect(record.actual_hours).toEqual(new Prisma.Decimal(1.5));
      expect(record.internal_cost_rate).toEqual(new Prisma.Decimal(35));
    });

    it('constructs a part line item record with PENDING_PICK status', () => {
      const record = buildNewTaskLineItemRecord('ten-1', 'task-1', {
        type: WorkshopLineItemType.PART,
        itemNo: 'P-01',
        description: 'Oil filter',
        qty: 2,
        unitPrice: 15,
      });

      expect(record.type).toBe(WorkshopLineItemType.PART);
      expect(record.part_execution_status).toBe(
        WorkshopPartLineExecutionStatus.PENDING_PICK,
      );
      expect(record.labor_operation_id).toBeNull();
      expect(record.standard_aw).toBeNull();
      expect(record.actual_hours).toBeNull();
      expect(record.internal_cost_rate).toBeNull();
    });
  });

  describe('classifyDeletedLineItems', () => {
    it('classifies unreferenced items for hard deletion', () => {
      const existing = [
        { id: 'item-1', part_execution_status: null },
        { id: 'item-2', part_execution_status: null },
      ];
      const submittedIds = ['item-1'];

      const result = classifyDeletedLineItems(existing, submittedIds);
      expect(result.deletedIds).toEqual(['item-2']);
      expect(result.hardDeleteIds).toEqual(['item-2']);
      expect(result.cancelIds).toEqual([]);
      expect(result.consumedIds).toEqual([]);
    });

    it('identifies when no items are deleted', () => {
      const existing = [{ id: 'item-1', part_execution_status: null }];
      const submittedIds = ['item-1', 'item-2'];

      const result = classifyDeletedLineItems(existing, submittedIds);
      expect(result.deletedIds).toEqual([]);
      expect(result.hardDeleteIds).toEqual([]);
    });

    it('classifies items with reservations as cancelled when not consumed', () => {
      const existing = [
        { id: 'item-1', part_execution_status: null },
        { id: 'item-2', part_execution_status: null },
      ];
      const submittedIds = ['item-1'];
      const reservations = [
        { workshop_task_line_item_id: 'item-2', quantity_consumed: 0 },
      ];

      const result = classifyDeletedLineItems(
        existing,
        submittedIds,
        reservations,
      );
      expect(result.deletedIds).toEqual(['item-2']);
      expect(result.hardDeleteIds).toEqual([]);
      expect(result.cancelIds).toEqual(['item-2']);
      expect(result.consumedIds).toEqual([]);
    });

    it('classifies items with consumed reservations as consumed', () => {
      const existing = [
        { id: 'item-1', part_execution_status: null },
        { id: 'item-2', part_execution_status: null },
      ];
      const submittedIds = ['item-1'];
      const reservations = [
        { workshop_task_line_item_id: 'item-2', quantity_consumed: 1 },
      ];

      const result = classifyDeletedLineItems(
        existing,
        submittedIds,
        reservations,
      );
      expect(result.deletedIds).toEqual(['item-2']);
      expect(result.hardDeleteIds).toEqual([]);
      expect(result.cancelIds).toEqual([]);
      expect(result.consumedIds).toEqual(['item-2']);
    });
  });

  describe('resolveOrderStatusConflict', () => {
    it('rethrows non-ConflictException errors', async () => {
      const tx = {} as any;
      await expect(
        resolveOrderStatusConflict({
          tx,
          tenantId: 'ten-1',
          orderId: 'wo-1',
          nextOrderStatus: WorkshopOrderStatus.COMPLETED,
          error: new Error('DB error'),
          siteId: 'site-1',
        }),
      ).rejects.toThrow('DB error');
    });

    it('throws NotFoundException if latest order cannot be found', async () => {
      const tx = {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      await expect(
        resolveOrderStatusConflict({
          tx,
          tenantId: 'ten-1',
          orderId: 'wo-1',
          nextOrderStatus: WorkshopOrderStatus.COMPLETED,
          error: new ConflictException('race'),
          siteId: 'site-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns false if latest order is INVOICED', async () => {
      const tx = {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue({
            status: WorkshopOrderStatus.INVOICED,
          }),
        },
      } as any;

      const result = await resolveOrderStatusConflict({
        tx,
        tenantId: 'ten-1',
        orderId: 'wo-1',
        nextOrderStatus: WorkshopOrderStatus.COMPLETED,
        error: new ConflictException('race'),
        siteId: 'site-1',
      });
      expect(result).toBe(false);
    });

    it('returns true if latest order has already reached next status', async () => {
      const tx = {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue({
            status: WorkshopOrderStatus.COMPLETED,
          }),
        },
      } as any;

      const result = await resolveOrderStatusConflict({
        tx,
        tenantId: 'ten-1',
        orderId: 'wo-1',
        nextOrderStatus: WorkshopOrderStatus.COMPLETED,
        error: new ConflictException('race'),
        siteId: 'site-1',
      });
      expect(result).toBe(true);
    });

    it('rethrows ConflictException if latest order reached an incompatible status', async () => {
      const tx = {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue({
            status: WorkshopOrderStatus.INTAKE,
          }),
        },
      } as any;

      const conflict = new ConflictException('race');
      await expect(
        resolveOrderStatusConflict({
          tx,
          tenantId: 'ten-1',
          orderId: 'wo-1',
          nextOrderStatus: WorkshopOrderStatus.COMPLETED,
          error: conflict,
          siteId: 'site-1',
        }),
      ).rejects.toBe(conflict);
    });
  });

  describe('resolveDefaultTaskScheduledDate', () => {
    it('scopes site lookup by active siteId', async () => {
      const tx = {
        site: {
          findFirst: jest.fn().mockResolvedValue({ timezone: 'Europe/Berlin' }),
        },
      } as any;

      const date = await resolveDefaultTaskScheduledDate(
        tx,
        'ten-1',
        { tasks: [], scheduled_start_at: new Date('2026-09-10T10:00:00Z') },
        'site-99',
      );

      expect(tx.site.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: 'ten-1',
          id: 'site-99',
          is_active: true,
        },
        select: { timezone: true },
      });
      expect(date).toBeDefined();
    });
  });

  describe('assertLineQuantityDemand', () => {
    it('passes when submitted quantity meets or exceeds consumed + active demand', () => {
      const existingItems = [{ id: 'line-1' }];
      const dto = {
        expectedLineItemsVersion: 1,
        items: [
          {
            id: 'line-1',
            type: WorkshopLineItemType.PART,
            itemNo: 'P-1',
            description: 'Part 1',
            qty: 5,
            unitPrice: 10,
          },
        ],
      };
      const reservations = [
        {
          workshop_task_line_item_id: 'line-1',
          quantity: 4,
          quantity_consumed: 1,
          quantity_returned: 0,
          status: PartsReservationStatus.OPEN,
        },
      ];

      expect(() =>
        assertLineQuantityDemand(existingItems, dto, reservations),
      ).not.toThrow();
    });

    it('throws ConflictException when requested quantity is less than minimum quantity', () => {
      const existingItems = [{ id: 'line-1' }];
      const dto = {
        expectedLineItemsVersion: 1,
        items: [
          {
            id: 'line-1',
            type: WorkshopLineItemType.PART,
            itemNo: 'P-1',
            description: 'Part 1',
            qty: 2,
            unitPrice: 10,
          },
        ],
      };
      const reservations = [
        {
          workshop_task_line_item_id: 'line-1',
          quantity: 4,
          quantity_consumed: 1,
          quantity_returned: 0,
          status: PartsReservationStatus.OPEN,
        },
      ];

      expect(() =>
        assertLineQuantityDemand(existingItems, dto, reservations),
      ).toThrow(
        new ConflictException(
          'Workshop line quantity cannot be reduced below allocated or consumed demand',
        ),
      );
    });

    it('throws ConflictException when parts reservation has negative remaining demand', () => {
      const existingItems = [{ id: 'line-1' }];
      const dto = {
        expectedLineItemsVersion: 1,
        items: [
          {
            id: 'line-1',
            type: WorkshopLineItemType.PART,
            itemNo: 'P-1',
            description: 'Part 1',
            qty: 5,
            unitPrice: 10,
          },
        ],
      };
      const reservations = [
        {
          workshop_task_line_item_id: 'line-1',
          quantity: 2,
          quantity_consumed: 3,
          quantity_returned: 0,
          status: PartsReservationStatus.OPEN,
        },
      ];

      expect(() =>
        assertLineQuantityDemand(existingItems, dto, reservations),
      ).toThrow(
        new ConflictException(
          'Parts reservation line-1 has invalid negative remaining demand',
        ),
      );
    });

    it('ignores cancelled or completed reservations when calculating active commitment', () => {
      const existingItems = [{ id: 'line-1' }];
      const dto = {
        expectedLineItemsVersion: 1,
        items: [
          {
            id: 'line-1',
            type: WorkshopLineItemType.PART,
            itemNo: 'P-1',
            description: 'Part 1',
            qty: 1,
            unitPrice: 10,
          },
        ],
      };
      const reservations = [
        {
          workshop_task_line_item_id: 'line-1',
          quantity: 10,
          quantity_consumed: 0,
          quantity_returned: 0,
          status: PartsReservationStatus.CANCELLED,
        },
      ];

      expect(() =>
        assertLineQuantityDemand(existingItems, dto, reservations),
      ).not.toThrow();
    });
  });

  describe('handleDeletedLineItems', () => {
    it('returns early when no items are deleted', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            deleteMany: jest.fn(),
            updateMany: jest.fn(),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };
      const existing = [{ id: 'line-1', part_execution_status: null }];
      const submittedIds = ['line-1'];

      await handleDeletedLineItems(ctx, existing, submittedIds, []);

      expect(ctx.tx.workshopTaskLineItem.deleteMany).not.toHaveBeenCalled();
      expect(ctx.tx.workshopTaskLineItem.updateMany).not.toHaveBeenCalled();
    });

    it('releases active reservations via releaseReservation callback', async () => {
      const releaseMock = jest.fn().mockResolvedValue(undefined);
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            updateMany: jest.fn(),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
        returnLocationId: 'loc-ret',
        releaseReservation: releaseMock,
      };
      const existing = [{ id: 'line-1', part_execution_status: null }];
      const submittedIds: string[] = [];
      const reservations = [
        {
          id: 'res-1',
          workshop_task_line_item_id: 'line-1',
          quantity: 5,
          quantity_consumed: 0,
          quantity_returned: 0,
          quantity_staged: 2,
          status: PartsReservationStatus.STAGED,
        },
      ];

      await handleDeletedLineItems(ctx, existing, submittedIds, reservations);

      expect(releaseMock).toHaveBeenCalledWith(
        'res-1',
        { returnLocationId: 'loc-ret' },
        ctx.tx,
      );
    });

    it('throws ConflictException when consumed line items are deleted without active reservations', async () => {
      const ctx = {
        tx: {} as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };
      const existing = [{ id: 'line-1', part_execution_status: null }];
      const submittedIds: string[] = [];
      const reservations = [
        {
          id: 'res-1',
          workshop_task_line_item_id: 'line-1',
          quantity: 2,
          quantity_consumed: 2,
          quantity_returned: 0,
          quantity_staged: 0,
          status: PartsReservationStatus.FULFILLED,
        },
      ];

      await expect(
        handleDeletedLineItems(ctx, existing, submittedIds, reservations),
      ).rejects.toThrow(
        new ConflictException(
          'Consumed line items must be released before removal',
        ),
      );
    });

    it('hard-deletes lines that have no operational history and are unconsumed', async () => {
      const ctx = {
        tx: {
          warrantyClaimLine: { findFirst: jest.fn().mockResolvedValue(null) },
          workshopTaskLineItem: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            updateMany: jest.fn(),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };
      const existing = [{ id: 'line-1', part_execution_status: null }];
      const submittedIds: string[] = [];

      await handleDeletedLineItems(ctx, existing, submittedIds, []);

      expect(ctx.tx.workshopTaskLineItem.deleteMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'ten-1',
          workshop_task_id: 'task-1',
          id: { in: ['line-1'] },
          workshop_task: { workshop_order: { site_id: 'site-1' } },
        },
      });
    });

    it('cancels lines that have operational history but are unconsumed', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            deleteMany: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };
      const existing = [{ id: 'line-1', part_execution_status: null }];
      const submittedIds: string[] = [];
      const reservations = [
        {
          id: 'res-1',
          workshop_task_line_item_id: 'line-1',
          quantity: 2,
          quantity_consumed: 0,
          quantity_returned: 2,
          quantity_staged: 0,
          status: PartsReservationStatus.CANCELLED,
        },
      ];

      await handleDeletedLineItems(ctx, existing, submittedIds, reservations);

      expect(ctx.tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'ten-1',
          workshop_task_id: 'task-1',
          id: { in: ['line-1'] },
          workshop_task: { workshop_order: { site_id: 'site-1' } },
        },
        data: {
          part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
        },
      });
    });
  });

  describe('updateExistingTaskLineItems', () => {
    it('returns early when there are no items with an id to update', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: { updateMany: jest.fn() },
          partsReservation: { findMany: jest.fn() },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };

      await updateExistingTaskLineItems(ctx, [
        {
          type: WorkshopLineItemType.LABOR,
          itemNo: 'LAB-1',
          description: 'New item',
          qty: 1,
          unitPrice: 50,
        },
      ]);

      expect(ctx.tx.workshopTaskLineItem.updateMany).not.toHaveBeenCalled();
      expect(ctx.tx.partsReservation.findMany).not.toHaveBeenCalled();
    });

    it('updates labor item fields correctly', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          partsReservation: { findMany: jest.fn().mockResolvedValue([]) },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };

      await updateExistingTaskLineItems(ctx, [
        {
          id: 'labor-1',
          type: WorkshopLineItemType.LABOR,
          itemNo: 'LAB-1',
          description: 'Oil change',
          qty: 2,
          unitPrice: 60,
          actualHours: 1.5,
          standardAw: 2,
          internalCostRate: 40,
          laborOperationId: 'op-123',
        },
      ]);

      expect(ctx.tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'labor-1',
          tenant_id: 'ten-1',
          workshop_task_id: 'task-1',
          workshop_task: { workshop_order: { site_id: 'site-1' } },
        },
        data: {
          description: 'Oil change',
          quantity: new Prisma.Decimal(2),
          unit_price: new Prisma.Decimal(60),
          actual_hours: new Prisma.Decimal(1.5),
          standard_aw: new Prisma.Decimal(2),
          internal_cost_rate: new Prisma.Decimal(40),
          labor_operation_id: 'op-123',
        },
      });
    });

    it('computes CONSUMED execution status when consumed >= requested qty', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          partsReservation: {
            findMany: jest.fn().mockResolvedValue([
              {
                workshop_task_line_item_id: 'part-1',
                quantity_consumed: new Prisma.Decimal(2),
                quantity_staged: new Prisma.Decimal(0),
              },
            ]),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };

      await updateExistingTaskLineItems(ctx, [
        {
          id: 'part-1',
          type: WorkshopLineItemType.PART,
          itemNo: 'P-1',
          description: 'Filter',
          qty: 2,
          unitPrice: 15,
        },
      ]);

      expect(ctx.tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            part_execution_status: WorkshopPartLineExecutionStatus.CONSUMED,
          }),
        }),
      );
    });

    it('computes STAGED execution status when staged > 0 and consumed < requested qty', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          partsReservation: {
            findMany: jest.fn().mockResolvedValue([
              {
                workshop_task_line_item_id: 'part-1',
                quantity_consumed: new Prisma.Decimal(0),
                quantity_staged: new Prisma.Decimal(2),
              },
            ]),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };

      await updateExistingTaskLineItems(ctx, [
        {
          id: 'part-1',
          type: WorkshopLineItemType.PART,
          itemNo: 'P-1',
          description: 'Filter',
          qty: 2,
          unitPrice: 15,
        },
      ]);

      expect(ctx.tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            part_execution_status: WorkshopPartLineExecutionStatus.STAGED,
          }),
        }),
      );
    });

    it('computes PENDING_PICK execution status when neither consumed nor staged', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          partsReservation: { findMany: jest.fn().mockResolvedValue([]) },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };

      await updateExistingTaskLineItems(ctx, [
        {
          id: 'part-1',
          type: WorkshopLineItemType.PART,
          itemNo: 'P-1',
          description: 'Filter',
          qty: 2,
          unitPrice: 15,
        },
      ]);

      expect(ctx.tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
          }),
        }),
      );
    });
  });

  describe('lockWorkshopRows', () => {
    it('returns early when ids array is empty', async () => {
      const tx = { $queryRaw: jest.fn() } as any;
      await lockWorkshopRows({
        tx,
        tableName: 'workshop_tasks',
        tenantId: 'ten-1',
        ids: [],
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('locks workshop_tasks with siteId via joined workshop_orders query', async () => {
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
      await lockWorkshopRows({
        tx,
        tableName: 'workshop_tasks',
        tenantId: 'ten-1',
        ids: ['task-2', 'task-1'],
        siteId: 'site-1',
      });
      expect(tx.$queryRaw).toHaveBeenCalled();
    });

    it('locks generic table rows for parts_reservations', async () => {
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
      await lockWorkshopRows({
        tx,
        tableName: 'parts_reservations',
        tenantId: 'ten-1',
        ids: ['res-1'],
      });
      expect(tx.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('findLineReservationHistory', () => {
    it('returns empty array when existingItems is empty', async () => {
      const tx = {
        partsReservation: { findMany: jest.fn() },
      } as any;

      const result = await findLineReservationHistory(
        tx,
        'ten-1',
        'site-1',
        [],
      );

      expect(result).toEqual([]);
      expect(tx.partsReservation.findMany).not.toHaveBeenCalled();
    });

    it('queries partsReservation scoped to tenant and site', async () => {
      const tx = {
        partsReservation: {
          findMany: jest.fn().mockResolvedValue([{ id: 'res-1' }]),
        },
      } as any;

      const result = await findLineReservationHistory(tx, 'ten-1', 'site-1', [
        { id: 'line-1' },
      ]);

      expect(result).toEqual([{ id: 'res-1' }]);
      expect(tx.partsReservation.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'ten-1',
          workshop_task_line_item_id: { in: ['line-1'] },
          workshop_task_line_item: {
            workshop_task: { workshop_order: { site_id: 'site-1' } },
          },
        },
        select: {
          id: true,
          workshop_task_line_item_id: true,
          quantity: true,
          quantity_consumed: true,
          quantity_returned: true,
          quantity_staged: true,
          status: true,
        },
      });
    });
  });

  describe('releaseDeletedLineReservations', () => {
    it('filters active reservations for deleted items and invokes releaseReservation', async () => {
      const releaseMock = jest.fn().mockResolvedValue(undefined);
      const ctx = {
        tx: {} as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
        returnLocationId: 'loc-1',
        releaseReservation: releaseMock,
      };
      const reservations = [
        {
          id: 'res-1',
          workshop_task_line_item_id: 'line-1',
          quantity: 2,
          quantity_consumed: 0,
          quantity_returned: 0,
          quantity_staged: 2,
          status: PartsReservationStatus.STAGED,
        },
        {
          id: 'res-2',
          workshop_task_line_item_id: 'line-2', // not in deletedIds
          quantity: 2,
          quantity_consumed: 0,
          quantity_returned: 0,
          quantity_staged: 2,
          status: PartsReservationStatus.STAGED,
        },
        {
          id: 'res-3',
          workshop_task_line_item_id: 'line-1',
          quantity: 2,
          quantity_consumed: 0,
          quantity_returned: 2,
          quantity_staged: 0,
          status: PartsReservationStatus.CANCELLED, // inactive slice
        },
      ];

      const result = await releaseDeletedLineReservations(
        ctx,
        ['line-1'],
        reservations,
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('res-1');
      expect(releaseMock).toHaveBeenCalledWith(
        'res-1',
        { returnLocationId: 'loc-1' },
        ctx.tx,
      );
    });
  });

  describe('executeLineDeletionsAndCancellations', () => {
    it('refuses to hard-delete a line that a warranty claim still references', async () => {
      const ctx = {
        tx: {
          warrantyClaimLine: {
            findFirst: jest.fn().mockResolvedValue({
              warranty_claim: { status: 'DRAFT' },
            }),
          },
          workshopTaskLineItem: {
            deleteMany: jest.fn(),
            updateMany: jest.fn(),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };

      await expect(
        executeLineDeletionsAndCancellations(ctx, ['hard-1'], []),
      ).rejects.toThrow(ConflictException);

      expect(ctx.tx.warrantyClaimLine.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: 'ten-1',
          workshop_task_line_item_id: { in: ['hard-1'] },
        },
        select: { warranty_claim: { select: { status: true } } },
      });
      expect(ctx.tx.workshopTaskLineItem.deleteMany).not.toHaveBeenCalled();
    });

    it('executes deleteMany and updateMany scoped to tenant and site', async () => {
      const ctx = {
        tx: {
          warrantyClaimLine: { findFirst: jest.fn().mockResolvedValue(null) },
          workshopTaskLineItem: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };

      await executeLineDeletionsAndCancellations(ctx, ['hard-1'], ['cancel-1']);

      expect(ctx.tx.workshopTaskLineItem.deleteMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'ten-1',
          workshop_task_id: 'task-1',
          id: { in: ['hard-1'] },
          workshop_task: { workshop_order: { site_id: 'site-1' } },
        },
      });

      expect(ctx.tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'ten-1',
          workshop_task_id: 'task-1',
          id: { in: ['cancel-1'] },
          workshop_task: { workshop_order: { site_id: 'site-1' } },
        },
        data: {
          part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
        },
      });
    });
  });

  describe('computePartItemExecutionStatus', () => {
    it('returns CONSUMED when consumed >= requested qty', () => {
      const status = computePartItemExecutionStatus(2, [
        {
          workshop_task_line_item_id: 'line-1',
          quantity_consumed: 2,
          quantity_staged: 0,
        },
      ]);
      expect(status).toBe(WorkshopPartLineExecutionStatus.CONSUMED);
    });

    it('returns STAGED when staged > 0 and consumed < requested qty', () => {
      const status = computePartItemExecutionStatus(2, [
        {
          workshop_task_line_item_id: 'line-1',
          quantity_consumed: 0,
          quantity_staged: 1,
        },
      ]);
      expect(status).toBe(WorkshopPartLineExecutionStatus.STAGED);
    });

    it('returns PENDING_PICK when no quantity is staged or consumed', () => {
      const status = computePartItemExecutionStatus(2, [
        {
          workshop_task_line_item_id: 'line-1',
          quantity_consumed: 0,
          quantity_staged: 0,
        },
      ]);
      expect(status).toBe(WorkshopPartLineExecutionStatus.PENDING_PICK);
    });
  });

  describe('derivePartExecutionStatusMap', () => {
    it('derives execution status map for parts and ignores labor items', () => {
      const items = [
        {
          id: 'part-1',
          type: WorkshopLineItemType.PART,
          qty: 2,
          unitPrice: 10,
          itemNo: 'P-1',
          description: 'Part',
        },
        {
          id: 'labor-1',
          type: WorkshopLineItemType.LABOR,
          qty: 1,
          unitPrice: 50,
          itemNo: 'L-1',
          description: 'Labor',
        },
      ];
      const reservationsByLine = new Map([
        [
          'part-1',
          [
            {
              workshop_task_line_item_id: 'part-1',
              quantity_consumed: 2,
              quantity_staged: 0,
            },
          ],
        ],
      ]);

      const map = derivePartExecutionStatusMap(items, reservationsByLine);
      expect(map.get('part-1')).toBe(WorkshopPartLineExecutionStatus.CONSUMED);
      expect(map.has('labor-1')).toBe(false);
    });
  });

  describe('groupReservationsByLine and fetchPartLineReservations', () => {
    it('groups reservations by line item id', () => {
      const res1 = {
        workshop_task_line_item_id: 'line-1',
        quantity_consumed: 1,
        quantity_staged: 0,
      };
      const res2 = {
        workshop_task_line_item_id: 'line-1',
        quantity_consumed: 0,
        quantity_staged: 1,
      };
      const res3 = {
        workshop_task_line_item_id: 'line-2',
        quantity_consumed: 0,
        quantity_staged: 0,
      };

      const grouped = groupReservationsByLine([res1, res2, res3]);
      expect(grouped.get('line-1')).toEqual([res1, res2]);
      expect(grouped.get('line-2')).toEqual([res3]);
    });

    it('returns empty array when partLineIds is empty', async () => {
      const tx = { partsReservation: { findMany: jest.fn() } } as any;
      const res = await fetchPartLineReservations(tx, 'ten-1', []);
      expect(res).toEqual([]);
      expect(tx.partsReservation.findMany).not.toHaveBeenCalled();
    });
  });

  describe('executeExistingLineItemUpdates', () => {
    it('updates items with status from status map', async () => {
      const ctx = {
        tx: {
          workshopTaskLineItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        } as any,
        tenantId: 'ten-1',
        siteId: 'site-1',
        taskId: 'task-1',
      };
      const items = [
        {
          id: 'part-1',
          type: WorkshopLineItemType.PART,
          qty: 2,
          unitPrice: 10,
          itemNo: 'P-1',
          description: 'Part',
        },
      ];
      const statusMap = new Map([
        ['part-1', WorkshopPartLineExecutionStatus.CONSUMED],
      ]);

      await executeExistingLineItemUpdates(ctx, items, statusMap);

      expect(ctx.tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'part-1',
          tenant_id: 'ten-1',
          workshop_task_id: 'task-1',
          workshop_task: { workshop_order: { site_id: 'site-1' } },
        },
        data: expect.objectContaining({
          part_execution_status: WorkshopPartLineExecutionStatus.CONSUMED,
        }),
      });
    });
  });
});
