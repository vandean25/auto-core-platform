import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import {
  buildNewTaskLineItemRecord,
  buildTaskUpdateFieldData,
  classifyDeletedLineItems,
  computeFieldNameText,
  handleTaskLineItemsError,
  resolveDefaultTaskScheduledDate,
  resolveOrderStatusConflict,
} from './workshop-task.helpers';

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

      const result = classifyDeletedLineItems(existing, submittedIds, reservations);
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

      const result = classifyDeletedLineItems(existing, submittedIds, reservations);
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
        resolveOrderStatusConflict(
          tx,
          'ten-1',
          'wo-1',
          WorkshopOrderStatus.COMPLETED,
          new Error('DB error'),
          'site-1',
        ),
      ).rejects.toThrow('DB error');
    });

    it('throws NotFoundException if latest order cannot be found', async () => {
      const tx = {
        workshopOrder: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      await expect(
        resolveOrderStatusConflict(
          tx,
          'ten-1',
          'wo-1',
          WorkshopOrderStatus.COMPLETED,
          new ConflictException('race'),
          'site-1',
        ),
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

      const result = await resolveOrderStatusConflict(
        tx,
        'ten-1',
        'wo-1',
        WorkshopOrderStatus.COMPLETED,
        new ConflictException('race'),
        'site-1',
      );
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

      const result = await resolveOrderStatusConflict(
        tx,
        'ten-1',
        'wo-1',
        WorkshopOrderStatus.COMPLETED,
        new ConflictException('race'),
        'site-1',
      );
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
        resolveOrderStatusConflict(
          tx,
          'ten-1',
          'wo-1',
          WorkshopOrderStatus.COMPLETED,
          conflict,
          'site-1',
        ),
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
});
