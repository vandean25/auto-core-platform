import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoiceLifecycleService } from './purchase-invoice-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseInvoiceStatus } from '@prisma/client';

describe('PurchaseInvoiceService', () => {
  let service: PurchaseInvoiceService;
  let mockPrisma: any;
  let mockRealtime: any;
  let mockTenantContext: any;
  let mockLifecycle: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb: (tx: any) => any) => cb(mockPrisma)),
      vendor: {
        findFirst: jest.fn(),
      },
      purchaseOrderItem: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      purchaseInvoice: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      purchaseInvoiceLine: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    mockRealtime = {
      emitEntityUpdated: jest.fn(),
    };

    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    };

    mockLifecycle = {
      post: jest.fn().mockResolvedValue({ success: true }),
      pay: jest.fn().mockResolvedValue({ success: true }),
      remove: jest.fn().mockResolvedValue({ success: true }),
      removeLine: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseInvoiceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DashboardRealtimeService, useValue: mockRealtime },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: PurchaseInvoiceLifecycleService, useValue: mockLifecycle },
      ],
    }).compile();

    service = module.get<PurchaseInvoiceService>(PurchaseInvoiceService);
  });

  describe('getUnbilledReceipts', () => {
    it('should return received items that have pending invoice quantity', async () => {
      mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([
        {
          id: 'poi-1',
          purchase_order_id: 'po-1',
          purchase_order: { order_number: 'PO-2026-0001' },
          catalog_item_id: 'ci-1',
          catalog_item: { name: 'Brake Pad' },
          quantity_received: 10,
          quantity_invoiced: 2,
          unit_cost: 45,
          purchase_invoice_lines: [],
        },
        {
          id: 'poi-2',
          purchase_order_id: 'po-1',
          purchase_order: { order_number: 'PO-2026-0001' },
          catalog_item_id: 'ci-2',
          catalog_item: { name: 'Oil Filter' },
          quantity_received: 5,
          quantity_invoiced: 5, // Fully invoiced
          unit_cost: 15,
          purchase_invoice_lines: [],
        },
      ]);

      const result = await service.getUnbilledReceipts('vendor-1');

      expect(result).toHaveLength(1);
      expect(result[0].purchaseOrderItemId).toBe('poi-1');
      expect(result[0].quantityPending).toBe(8);
      expect(result[0].purchaseOrderNumber).toBe('PO-2026-0001');
    });
  });

  describe('create', () => {
    it('should throw BadRequestException if vendor is not found', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          vendorId: 'vendor-unknown',
          vendorInvoiceNumber: 'INV-100',
          invoiceDate: '2026-09-01',
          dueDate: '2026-09-30',
          items: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create an invoice, increment PO items, and emit realtime event', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1' });
      mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([
        {
          id: 'poi-1',
          quantity_received: 10,
          quantity_invoiced: 0,
          purchase_order: { vendor_id: 'vendor-1' },
        },
      ]);
      const createdInvoice = {
        id: 'inv-1',
        status: PurchaseInvoiceStatus.DRAFT,
        lines: [],
      };
      mockPrisma.purchaseInvoice.create.mockResolvedValue(createdInvoice);

      const result = await service.create({
        vendorId: 'vendor-1',
        vendorInvoiceNumber: 'INV-100',
        invoiceDate: '2026-09-01',
        dueDate: '2026-09-30',
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            description: 'Item 1',
            quantity: 5,
            unitPrice: 20,
          },
        ],
      });

      expect(result).toBe(createdInvoice);
      expect(mockPrisma.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'poi-1', tenant_id: 'tenant-1' },
        data: { quantity_invoiced: { increment: 5 } },
      });
      expect(mockRealtime.emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
        type: 'PURCHASE_INVOICE',
        action: 'CREATED',
        entityId: 'inv-1',
      });
    });
  });

  describe('update', () => {
    it('should throw BadRequestException if invoice is no longer in DRAFT status', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1' });
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('inv-1', {
          vendorId: 'vendor-1',
          vendorInvoiceNumber: 'INV-100',
          invoiceDate: '2026-09-01',
          dueDate: '2026-09-30',
          items: [],
        }),
      ).rejects.toThrow('Invoice not found or no longer in DRAFT status');
    });

    it('should rollback previous PO quantities, validate new, update lines and reapply', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1' });
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.purchaseInvoice.findFirst
        .mockResolvedValueOnce({
          id: 'inv-1',
          lines: [{ purchase_order_item_id: 'poi-old', quantity: 3 }],
        })
        .mockResolvedValueOnce({
          id: 'inv-1',
          total_amount: 120,
          lines: [],
        });

      mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([
        {
          id: 'poi-new',
          quantity_received: 10,
          quantity_invoiced: 0,
          purchase_order: { vendor_id: 'vendor-1' },
        },
      ]);

      const result = await service.update('inv-1', {
        vendorId: 'vendor-1',
        vendorInvoiceNumber: 'INV-101',
        invoiceDate: '2026-09-01',
        dueDate: '2026-09-30',
        items: [
          {
            purchaseOrderItemId: 'poi-new',
            description: 'New Line',
            quantity: 4,
            unitPrice: 25,
          },
        ],
      });

      expect(result.id).toBe('inv-1');
      // Verify rollback of old item
      expect(mockPrisma.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'poi-old', tenant_id: 'tenant-1' },
        data: { quantity_invoiced: { decrement: 3 } },
      });
      // Verify increment of new item
      expect(mockPrisma.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'poi-new', tenant_id: 'tenant-1' },
        data: { quantity_invoiced: { increment: 4 } },
      });
      expect(mockRealtime.emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
        type: 'PURCHASE_INVOICE',
        action: 'UPDATED',
        entityId: 'inv-1',
      });
    });
  });

  describe('findAll', () => {
    it('should throw BadRequestException on invalid sortBy parameter', async () => {
      await expect(
        service.findAll(undefined, undefined, 1, 25, 'invalid_column'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should paginate and sort correctly', async () => {
      mockPrisma.purchaseInvoice.findMany.mockResolvedValue([{ id: 'inv-1' }]);
      mockPrisma.purchaseInvoice.count.mockResolvedValue(1);

      const result = await service.findAll(
        'vendor-1',
        PurchaseInvoiceStatus.DRAFT,
        1,
        25,
        'due_date',
        'desc',
      );

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        pageSize: 25,
        pageCount: 1,
      });
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if invoice not found', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue(null);

      await expect(service.findOne('inv-missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return invoice when found', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({ id: 'inv-1' });

      const result = await service.findOne('inv-1');
      expect(result).toEqual({ id: 'inv-1' });
    });
  });

  describe('lifecycle delegation', () => {
    it('post should delegate to lifecycle service and emit realtime', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'inv-1', status: PurchaseInvoiceStatus.POSTED } as any);

      const result = await service.post('inv-1');
      expect(mockLifecycle.post).toHaveBeenCalledWith('tenant-1', 'inv-1');
      expect(mockRealtime.emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
        type: 'PURCHASE_INVOICE',
        action: 'UPDATED',
        entityId: 'inv-1',
      });
      expect(result.id).toBe('inv-1');
    });

    it('pay should delegate to lifecycle service and emit realtime', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'inv-1', status: PurchaseInvoiceStatus.PAID } as any);

      const result = await service.pay('inv-1');
      expect(mockLifecycle.pay).toHaveBeenCalledWith('tenant-1', 'inv-1');
      expect(mockRealtime.emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
        type: 'PURCHASE_INVOICE',
        action: 'UPDATED',
        entityId: 'inv-1',
      });
      expect(result.id).toBe('inv-1');
    });

    it('remove should delegate to lifecycle service and emit realtime', async () => {
      const result = await service.remove('inv-1');
      expect(mockLifecycle.remove).toHaveBeenCalledWith('tenant-1', 'inv-1');
      expect(mockRealtime.emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
        type: 'PURCHASE_INVOICE',
        action: 'DELETED',
        entityId: 'inv-1',
      });
      expect(result).toEqual({ success: true });
    });

    it('removeLine should delegate to lifecycle service and emit realtime', async () => {
      const result = await service.removeLine('inv-1', 'line-1');
      expect(mockLifecycle.removeLine).toHaveBeenCalledWith('tenant-1', 'inv-1', 'line-1');
      expect(mockRealtime.emitEntityUpdated).toHaveBeenCalledWith('tenant-1', {
        type: 'PURCHASE_INVOICE',
        action: 'UPDATED',
        entityId: 'inv-1',
      });
      expect(result).toEqual({ success: true });
    });
  });
});
