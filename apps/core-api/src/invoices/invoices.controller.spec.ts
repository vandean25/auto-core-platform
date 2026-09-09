import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/node';
import { Readable } from 'node:stream';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { InvoiceStatus } from '@prisma/client';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

describe('InvoicesController', () => {
  let controller: InvoicesController;
  let invoicesService: {
    createDraftInvoice: jest.Mock;
    issueInvoice: jest.Mock;
  };
  let invoicePdfService: {
    requestGeneration: jest.Mock;
    generateNow: jest.Mock;
    getPdf: jest.Mock;
  };

  const originalTargetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL;

  beforeEach(async () => {
    invoicesService = {
      createDraftInvoice: jest.fn(),
      issueInvoice: jest.fn(),
    };

    invoicePdfService = {
      requestGeneration: jest.fn(),
      generateNow: jest.fn(),
      getPdf: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        { provide: InvoicesService, useValue: invoicesService },
        { provide: InvoicePdfService, useValue: invoicePdfService },
        {
          provide: TenantContextService,
          useValue: { setTenantIdForWorker: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<InvoicesController>(InvoicesController);
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalTargetBaseUrl === undefined) {
      delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
    } else {
      process.env.CLOUD_TASKS_TARGET_BASE_URL = originalTargetBaseUrl;
    }
  });

  describe('createDraft', () => {
    it('delegates draft invoice creation with workshopOrderId', async () => {
      const mockInvoice = {
        id: 'inv-123',
        status: InvoiceStatus.DRAFT,
        workshop_order_id: 'wo-456',
      };
      invoicesService.createDraftInvoice.mockResolvedValue(mockInvoice);

      const result = await controller.createDraft({
        workshopOrderId: 'wo-456',
      });

      expect(result).toBe(mockInvoice);
      expect(invoicesService.createDraftInvoice).toHaveBeenCalledWith('wo-456');
    });
  });

  describe('issue', () => {
    it('delegates invoice issuance with invoice id', async () => {
      const mockIssuedInvoice = {
        id: 'inv-123',
        status: InvoiceStatus.ISSUED,
        invoice_number: 'RE-2026-0001',
      };
      invoicesService.issueInvoice.mockResolvedValue(mockIssuedInvoice);

      const result = await controller.issue('inv-123');

      expect(result).toBe(mockIssuedInvoice);
      expect(invoicesService.issueInvoice).toHaveBeenCalledWith('inv-123');
    });
  });

  describe('generatePdf', () => {
    it('uses configured CLOUD_TASKS_TARGET_BASE_URL when available', async () => {
      process.env.CLOUD_TASKS_TARGET_BASE_URL =
        'https://tasks.autocore.internal';
      const expectedResponse = {
        mode: 'enqueued',
        invoiceId: 'inv-123',
        taskId: 'task-999',
      };
      invoicePdfService.requestGeneration.mockResolvedValue(expectedResponse);

      const result = await controller.generatePdf('inv-123');

      expect(result).toBe(expectedResponse);
      expect(invoicePdfService.requestGeneration).toHaveBeenCalledWith(
        'inv-123',
        {
          targetBaseUrl: 'https://tasks.autocore.internal',
        },
      );
    });

    it('defaults targetBaseUrl to empty string when CLOUD_TASKS_TARGET_BASE_URL is not set', async () => {
      delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
      const expectedResponse = {
        mode: 'generated',
        invoiceId: 'inv-123',
        bucket: 'bucket-1',
        key: 'invoices/inv-123.pdf',
        generatedAt: new Date(),
      };
      invoicePdfService.requestGeneration.mockResolvedValue(expectedResponse);

      const result = await controller.generatePdf('inv-123');

      expect(result).toBe(expectedResponse);
      expect(invoicePdfService.requestGeneration).toHaveBeenCalledWith(
        'inv-123',
        {
          targetBaseUrl: '',
        },
      );
    });
  });

  describe('generatePdfWorker', () => {
    it('successfully runs generateNow without error', async () => {
      invoicePdfService.generateNow.mockResolvedValue(undefined);

      await expect(
        controller.generatePdfWorker('inv-123'),
      ).resolves.toBeUndefined();
      expect(invoicePdfService.generateNow).toHaveBeenCalledWith('inv-123');
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('swallows non-retryable 4xx HttpException and captures Sentry warning', async () => {
      const notFoundError = new NotFoundException('Invoice not found');
      invoicePdfService.generateNow.mockRejectedValue(notFoundError);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      await expect(
        controller.generatePdfWorker('inv-123'),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Dropping non-retryable invoice PDF worker error (invoiceId=inv-123): Invoice not found',
        ),
      );
      expect(Sentry.captureException).toHaveBeenCalledWith(notFoundError, {
        level: 'warning',
        tags: { invoiceId: 'inv-123', operation: 'pdf.worker' },
      });
      warnSpy.mockRestore();
    });

    it('swallows 400 BadRequestException as non-retryable error', async () => {
      const badRequestError = new BadRequestException(
        'Only ISSUED invoices can be rendered as PDF',
      );
      invoicePdfService.generateNow.mockRejectedValue(badRequestError);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      await expect(
        controller.generatePdfWorker('inv-123'),
      ).resolves.toBeUndefined();

      expect(Sentry.captureException).toHaveBeenCalledWith(badRequestError, {
        level: 'warning',
        tags: { invoiceId: 'inv-123', operation: 'pdf.worker' },
      });
      warnSpy.mockRestore();
    });

    it('rethrows 5xx HttpException so worker task can retry', async () => {
      const serverError = new HttpException(
        'Upstream PDF service failure',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      invoicePdfService.generateNow.mockRejectedValue(serverError);

      await expect(controller.generatePdfWorker('inv-123')).rejects.toThrow(
        serverError,
      );
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('rethrows generic Error so worker task can retry', async () => {
      const genericError = new Error('Database connection failed');
      invoicePdfService.generateNow.mockRejectedValue(genericError);

      await expect(controller.generatePdfWorker('inv-123')).rejects.toThrow(
        genericError,
      );
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe('getPdf', () => {
    it('returns StreamableFile with sanitized filename and default application/pdf content type', async () => {
      const stream = Readable.from(['pdf content']);
      invoicePdfService.getPdf.mockResolvedValue({
        filename: 'invoice-RE-2026-0001.pdf',
        contentType: 'application/pdf',
        contentLength: 1024,
        stream,
      });

      const result = await controller.getPdf('inv-123');

      expect(invoicePdfService.getPdf).toHaveBeenCalledWith('inv-123');
      expect(result.getStream()).toBe(stream);
      expect(result.getHeaders()).toEqual({
        type: 'application/pdf',
        disposition: 'inline; filename="invoice-RE-2026-0001.pdf"',
        length: 1024,
      });
    });

    it('sanitizes quotes and newlines in filenames to underscores', async () => {
      const stream = Readable.from(['pdf content']);
      invoicePdfService.getPdf.mockResolvedValue({
        filename: 'invoice"test\r\nunsafe.pdf',
        contentType: 'application/pdf',
        contentLength: null,
        stream,
      });

      const result = await controller.getPdf('inv-123');

      expect(result.getHeaders()).toEqual({
        type: 'application/pdf',
        disposition: 'inline; filename="invoice_test_unsafe.pdf"',
        length: undefined,
      });
    });

    it('defaults contentType to application/pdf when empty or falsy', async () => {
      const stream = Readable.from(['pdf content']);
      invoicePdfService.getPdf.mockResolvedValue({
        filename: 'invoice.pdf',
        contentType: '',
        contentLength: null,
        stream,
      });

      const result = await controller.getPdf('inv-123');

      expect(result.getHeaders().type).toBe('application/pdf');
    });
  });
});
