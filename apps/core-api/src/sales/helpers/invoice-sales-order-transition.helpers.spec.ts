import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import {
  ensureSalesOrderInvoiceable,
  transitionLinkedSalesOrderToInvoiced,
} from './invoice-sales-order-transition.helpers.js';

describe('invoice-sales-order-transition.helpers', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const salesOrderId = 'so-1';

  const createTx = (status: SalesOrderStatus) => {
    const salesOrder = {
      findFirst: jest.fn().mockResolvedValue({ status }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    return { salesOrder };
  };

  describe('ensureSalesOrderInvoiceable', () => {
    it('auto-confirms a DRAFT sales order', async () => {
      const tx = createTx(SalesOrderStatus.DRAFT);

      const result = await ensureSalesOrderInvoiceable(
        tx as never,
        tenantId,
        siteId,
        salesOrderId,
      );

      expect(result).toBe(SalesOrderStatus.CONFIRMED);
      expect(tx.salesOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: salesOrderId,
            tenant_id: tenantId,
            status: SalesOrderStatus.DRAFT,
            site_id: siteId,
          }),
          data: { status: SalesOrderStatus.CONFIRMED },
        }),
      );
    });

    it('returns current status when already invoiceable', async () => {
      const tx = createTx(SalesOrderStatus.IN_PROGRESS);

      const result = await ensureSalesOrderInvoiceable(
        tx as never,
        tenantId,
        siteId,
        salesOrderId,
      );

      expect(result).toBe(SalesOrderStatus.IN_PROGRESS);
      expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
    });

    it('throws when sales order is missing', async () => {
      const tx = {
        salesOrder: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      await expect(
        ensureSalesOrderInvoiceable(tx as never, tenantId, siteId, salesOrderId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects invoicing when status cannot be advanced', async () => {
      const tx = createTx(SalesOrderStatus.INVOICED);

      await expect(
        ensureSalesOrderInvoiceable(tx as never, tenantId, siteId, salesOrderId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('transitionLinkedSalesOrderToInvoiced', () => {
    it('auto-confirms DRAFT then marks the sales order INVOICED', async () => {
      const tx = createTx(SalesOrderStatus.DRAFT);

      await transitionLinkedSalesOrderToInvoiced(
        tx as never,
        tenantId,
        siteId,
        salesOrderId,
      );

      expect(tx.salesOrder.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.salesOrder.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: { status: SalesOrderStatus.CONFIRMED },
        }),
      );
      expect(tx.salesOrder.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: { status: SalesOrderStatus.INVOICED },
        }),
      );
    });

    it('rejects sales orders that are already INVOICED', async () => {
      const tx = createTx(SalesOrderStatus.INVOICED);

      await expect(
        transitionLinkedSalesOrderToInvoiced(
          tx as never,
          tenantId,
          siteId,
          salesOrderId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
