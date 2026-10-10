import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, WorkshopOrderStatus } from '@prisma/client';
import {
  assertInvoiceEligibleForIssue,
  executeIssueInvoice,
} from './invoice-issue.helpers.js';

describe('invoice-issue.helpers', () => {
  describe('assertInvoiceEligibleForIssue', () => {
    it('throws BadRequestException when invoice has no workshop_order_id', () => {
      expect(() =>
        assertInvoiceEligibleForIssue({
          status: InvoiceStatus.DRAFT,
          workshop_order_id: null,
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when invoice status is not DRAFT', () => {
      expect(() =>
        assertInvoiceEligibleForIssue({
          status: InvoiceStatus.ISSUED,
          workshop_order_id: 'wo-1',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when invoice has no source document', () => {
      expect(() =>
        assertInvoiceEligibleForIssue({
          status: InvoiceStatus.DRAFT,
          workshop_order_id: null,
          sales_order_id: null,
          vehicle_sale_id: null,
        }),
      ).toThrow(BadRequestException);
    });

    it('passes when invoice has a valid source document', () => {
      expect(() =>
        assertInvoiceEligibleForIssue({
          status: InvoiceStatus.DRAFT,
          workshop_order_id: 'wo-1',
          sales_order_id: null,
          vehicle_sale_id: null,
        }),
      ).not.toThrow();
    });
  });

  describe('executeIssueInvoice', () => {
    const mockSnapshotCommit = {
      prepareV2Snapshot: jest.fn().mockResolvedValue({
        snapshot: { schema_version: 2 },
      }),
      persistV2Snapshot: jest.fn().mockResolvedValue(undefined),
    };

    const mockTx = {
      invoice: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      workshopOrder: {
        updateMany: jest.fn(),
      },
      workshopEstimate: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      invoiceSequence: {
        upsert: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('throws NotFoundException when invoice does not exist', async () => {
      mockTx.invoice.findFirst.mockResolvedValue(null);

      await expect(
        executeIssueInvoice(mockTx as any, {
          tenantId: 'tenant-1',
          invoiceId: 'inv-not-found',
          snapshotCommit: mockSnapshotCommit as any,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('successfully transitions invoice and workshop order to issued/invoiced', async () => {
      const draftInvoice = {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        status: InvoiceStatus.DRAFT,
        workshop_order_id: 'wo-1',
        invoice_number: null,
        items: [],
        customer: { id: 'cust-1' },
        vehicle: null,
        workshop_order: { id: 'wo-1' },
      };

      const issuedInvoice = {
        ...draftInvoice,
        status: InvoiceStatus.ISSUED,
        invoice_number: 'RE-2026-0005',
      };

      mockTx.invoice.findFirst
        .mockResolvedValueOnce(draftInvoice)
        .mockResolvedValueOnce(issuedInvoice);
      mockTx.invoice.updateMany.mockResolvedValue({ count: 1 });
      mockTx.invoiceSequence.upsert.mockResolvedValue({ current: 5 });
      mockTx.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

      const result = await executeIssueInvoice(mockTx as any, {
        tenantId: 'tenant-1',
        invoiceId: 'inv-1',
        snapshotCommit: mockSnapshotCommit as any,
      });

      expect(mockSnapshotCommit.prepareV2Snapshot).toHaveBeenCalled();
      expect(mockSnapshotCommit.persistV2Snapshot).toHaveBeenCalled();
      expect(mockTx.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 'tenant-1' },
        data: { invoice_number: 'RE-2026-0005' },
      });
      expect(mockTx.workshopOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'wo-1',
          tenant_id: 'tenant-1',
          status: WorkshopOrderStatus.COMPLETED,
        },
        data: { status: WorkshopOrderStatus.INVOICED },
      });
      expect(result.status).toBe(InvoiceStatus.ISSUED);
      expect(result.invoice_number).toBe('RE-2026-0005');
    });
  });
});
