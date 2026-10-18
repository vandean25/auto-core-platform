import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PartsReservationKind,
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertBackOfficeAccess,
  executeCreateOnHandReservation,
  fetchShortages,
  incrementTaskVersions,
  loadRequisitionResponse,
  ZERO,
} from './parts-requisition-lifecycle.helpers.js';

const tenantId = 'tenant-char';
const siteId = 'site-char';
const lineId = 'line-char';
const taskId = 'task-char';
const locationId = 'loc-char';
const stockId = 'stock-char';

describe('parts-requisition-lifecycle characterization', () => {
  describe('assertBackOfficeAccess', () => {
    it('allows non-TECH roles', () => {
      const tenantContext = {
        getAuthenticatedUser: () => ({ role: 'ADMIN' }),
      } as TenantContextService;
      expect(() => assertBackOfficeAccess(tenantContext)).not.toThrow();
    });

    it('rejects TECH role sessions', () => {
      const tenantContext = {
        getAuthenticatedUser: () => ({ role: 'TECH' }),
      } as TenantContextService;
      expect(() => assertBackOfficeAccess(tenantContext)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('incrementTaskVersions', () => {
    it('increments line_items_version for all task ids', async () => {
      const tx = {
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      } as any;

      await incrementTaskVersions(tx, tenantId, ['t-1', 't-2']);
      expect(tx.workshopTask.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, id: { in: ['t-1', 't-2'] } },
        data: { line_items_version: { increment: 1 } },
      });
    });

    it('no-ops when task id list is empty', async () => {
      const tx = {
        workshopTask: { updateMany: jest.fn() },
      } as any;
      await incrementTaskVersions(tx, tenantId, []);
      expect(tx.workshopTask.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('loadRequisitionResponse', () => {
    it('throws NotFoundException when requisition is missing', async () => {
      const tx = {
        partsRequisition: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      await expect(
        loadRequisitionResponse(tx, tenantId, 'missing-req'),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps loaded requisition through toRequisitionResponse', async () => {
      const now = new Date();
      const tx = {
        partsRequisition: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'req-1',
            tenant_id: tenantId,
            vehicle_make_brand_id: 3,
            status: PartsRequisitionStatus.DRAFT,
            createdAt: now,
            updatedAt: now,
            lines: [],
          }),
        },
      } as any;

      const response = await loadRequisitionResponse(tx, tenantId, 'req-1');
      expect(response.id).toBe('req-1');
      expect(response.tenantId).toBe(tenantId);
      expect(response.lines).toEqual([]);
    });
  });

  describe('fetchShortages', () => {
    it('returns only lines with positive shortage and meta totals', async () => {
      const prisma = {
        workshopTaskLineItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'line-short',
              workshop_task_id: 'task-1',
              item_no: 'P-1',
              description: 'Widget',
              quantity: new Prisma.Decimal(5),
              parts_reservations: [
                {
                  quantity: new Prisma.Decimal(1),
                  quantity_consumed: ZERO,
                  quantity_staged: ZERO,
                  quantity_returned: ZERO,
                  status: PartsReservationStatus.OPEN,
                },
              ],
              workshop_task: {
                id: 'task-1',
                workshop_order: {
                  id: 'order-1',
                  order_number: 'WO-9',
                  site_id: siteId,
                  vehicle: { make: 'Audi', make_brand_id: 7 },
                },
              },
            },
            {
              id: 'line-covered',
              workshop_task_id: 'task-2',
              item_no: 'P-2',
              description: 'Bolt',
              quantity: new Prisma.Decimal(2),
              parts_reservations: [
                {
                  quantity: new Prisma.Decimal(2),
                  quantity_consumed: ZERO,
                  quantity_staged: ZERO,
                  quantity_returned: ZERO,
                  status: PartsReservationStatus.OPEN,
                },
              ],
              workshop_task: {
                id: 'task-2',
                workshop_order: {
                  id: 'order-2',
                  order_number: 'WO-10',
                  site_id: siteId,
                  vehicle: { make: 'Audi', make_brand_id: 7 },
                },
              },
            },
          ]),
        },
      } as any;

      const result = await fetchShortages(prisma, tenantId, siteId, {});
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.workshopTaskLineItemId).toBe('line-short');
      expect(result.data[0]?.shortageQuantity).toBe('4');
      expect(result.meta.total).toBe(1);
      expect(result.meta.pageSize).toBe(1);
    });
  });

  describe('executeCreateOnHandReservation', () => {
    it('reserves stock and creates an OPEN on-hand slice', async () => {
      const line = {
        id: lineId,
        workshop_task_id: taskId,
        catalog_item_id: 'cat-1',
        quantity: new Prisma.Decimal(10),
      };
      const tx = {
        workshopTaskLineItem: {
          findFirst: jest.fn().mockResolvedValue(line),
        },
        storageLocation: {
          findFirst: jest.fn().mockResolvedValue({
            id: locationId,
            site_id: siteId,
          }),
        },
        partsReservation: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({
            id: 'res-new',
            tenant_id: tenantId,
            workshop_task_line_item_id: lineId,
            quantity: new Prisma.Decimal(2),
            quantity_consumed: ZERO,
            quantity_staged: ZERO,
            quantity_returned: ZERO,
            kind: PartsReservationKind.ON_HAND,
            status: PartsReservationStatus.OPEN,
            location_id: locationId,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
        inventoryStock: {
          findFirst: jest.fn().mockResolvedValue({
            id: stockId,
            site_id: siteId,
          }),
        },
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as any;
      const atpService = {
        reserveOnHand: jest.fn().mockResolvedValue(undefined),
      } as any;

      const result = await executeCreateOnHandReservation(
        tx,
        tenantId,
        siteId,
        {
          workshopTaskLineItemId: lineId,
          quantity: 2,
          locationId,
        },
        atpService,
      );

      expect(atpService.reserveOnHand).toHaveBeenCalledWith(
        { stockId, quantity: new Prisma.Decimal(2) },
        tx,
      );
      expect(result.quantity).toBe('2');
      expect(tx.workshopTaskLineItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: lineId,
            tenant_id: tenantId,
            type: WorkshopLineItemType.PART,
            workshop_task: expect.objectContaining({
              workshop_order: expect.objectContaining({
                site_id: siteId,
                status: {
                  in: [
                    WorkshopOrderStatus.SCHEDULED,
                    WorkshopOrderStatus.INTAKE,
                    WorkshopOrderStatus.IN_PROGRESS,
                  ],
                },
              }),
            }),
          }),
        }),
      );
    });
  });
});
