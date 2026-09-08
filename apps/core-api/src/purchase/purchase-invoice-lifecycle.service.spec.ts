import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseInvoiceStatus } from '@prisma/client';
import { PurchaseInvoiceLifecycleService } from './purchase-invoice-lifecycle.service';

describe('PurchaseInvoiceLifecycleService', () => {
  let service: PurchaseInvoiceLifecycleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb: (tx: any) => any) => cb(mockPrisma)),
      purchaseInvoice: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      purchaseInvoiceLine: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      purchaseOrderItem: {
        updateMany: jest.fn(),
      },
    };

    service = new PurchaseInvoiceLifecycleService(mockPrisma);
  });

  describe('post', () => {
    it('should throw NotFoundException if invoice does not exist', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue(null);

      await expect(service.post('t-1', 'inv-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if invoice is not in DRAFT status', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: PurchaseInvoiceStatus.POSTED,
      });

      await expect(service.post('t-1', 'inv-1')).rejects.toThrow(
        'Only DRAFT invoices can be posted',
      );
    });

    it('should throw BadRequestException if invoice has no lines', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: PurchaseInvoiceStatus.DRAFT,
      });
      mockPrisma.purchaseInvoiceLine.count.mockResolvedValue(0);

      await expect(service.post('t-1', 'inv-1')).rejects.toThrow(
        'Cannot post an invoice without lines',
      );
    });

    it('should throw BadRequestException if status update fails due to race condition', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: PurchaseInvoiceStatus.DRAFT,
      });
      mockPrisma.purchaseInvoiceLine.count.mockResolvedValue(2);
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.post('t-1', 'inv-1')).rejects.toThrow(
        'Failed to post: Invoice is no longer in DRAFT status',
      );
    });

    it('should successfully post invoice when status is DRAFT and lines exist', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: PurchaseInvoiceStatus.DRAFT,
      });
      mockPrisma.purchaseInvoiceLine.count.mockResolvedValue(2);
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.post('t-1', 'inv-1');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.purchaseInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 't-1', status: PurchaseInvoiceStatus.DRAFT },
        data: { status: PurchaseInvoiceStatus.POSTED },
      });
    });
  });

  describe('pay', () => {
    it('should throw BadRequestException if invoice is not in POSTED status or not found', async () => {
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.pay('t-1', 'inv-1')).rejects.toThrow(
        'Failed to pay: Invoice not found or not in POSTED status',
      );
    });

    it('should successfully transition invoice to PAID when POSTED', async () => {
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.pay('t-1', 'inv-1');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.purchaseInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 't-1', status: PurchaseInvoiceStatus.POSTED },
        data: { status: PurchaseInvoiceStatus.PAID },
      });
    });
  });

  describe('remove', () => {
    it('should throw BadRequestException if invoice is not locked in DRAFT status', async () => {
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('t-1', 'inv-1')).rejects.toThrow(
        'Invoice not found or no longer in DRAFT status',
      );
    });

    it('should rollback PO quantities and delete invoice atomically', async () => {
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        lines: [
          { purchase_order_item_id: 'poi-1', quantity: 5 },
          { purchase_order_item_id: null, quantity: 2 },
        ],
      });
      mockPrisma.purchaseInvoice.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('t-1', 'inv-1');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'poi-1', tenant_id: 't-1' },
        data: { quantity_invoiced: { decrement: 5 } },
      });
      expect(mockPrisma.purchaseInvoice.deleteMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 't-1', status: PurchaseInvoiceStatus.DRAFT },
      });
    });
  });

  describe('removeLine', () => {
    it('should throw NotFoundException if line is not found or does not belong to invoice', async () => {
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.purchaseInvoiceLine.findFirst.mockResolvedValue(null);

      await expect(service.removeLine('t-1', 'inv-1', 'line-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should decrement PO item, delete line, and update total amount', async () => {
      mockPrisma.purchaseInvoice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.purchaseInvoiceLine.findFirst.mockResolvedValue({
        id: 'line-1',
        purchase_invoice_id: 'inv-1',
        purchase_order_item_id: 'poi-1',
        quantity: 3,
      });
      mockPrisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.purchaseInvoiceLine.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.purchaseInvoiceLine.findMany.mockResolvedValue([
        { id: 'line-2', line_total: 100 },
      ]);

      const result = await service.removeLine('t-1', 'inv-1', 'line-1');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'poi-1', tenant_id: 't-1' },
        data: { quantity_invoiced: { decrement: 3 } },
      });
      expect(mockPrisma.purchaseInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 't-1', status: PurchaseInvoiceStatus.DRAFT },
        data: { total_amount: 100 },
      });
    });
  });
});
