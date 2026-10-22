import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InvoiceStatus } from '@prisma/client';
import type { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';

function asyncMock() {
  return jest.fn<(args: unknown) => Promise<unknown>>();
}

type FakeSpan = {
  name: string;
  op: string;
  attributes: Record<string, unknown>;
  setAttribute: jest.Mock;
  setAttributes: jest.Mock;
};

const recordedSpans: FakeSpan[] = [];

jest.unstable_mockModule('@sentry/node', () => ({
  getClient: () => ({}),
  startSpan: (
    options: {
      name: string;
      op: string;
      attributes?: Record<string, unknown>;
    },
    callback: (span: FakeSpan) => unknown,
  ) => {
    const span: FakeSpan = {
      name: options.name,
      op: options.op,
      attributes: { ...options.attributes },
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
    };
    recordedSpans.push(span);
    return callback(span);
  },
  getActiveSpan: () => undefined,
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
  getTraceData: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const { InvoicePdfService } = await import('./invoice-pdf.service.js');

describe('InvoicePdfService.requestGeneration span', () => {
  const tenantId = 'tenant-1';
  const invoiceId = 'invoice-1';
  const targetBaseUrl = 'https://worker.example.com/api';

  const invoiceRow = {
    id: invoiceId,
    status: InvoiceStatus.ISSUED,
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
  };

  let service: InstanceType<typeof InvoicePdfService>;
  let cloudTasks: jest.Mocked<
    Pick<CloudTasksService, 'isEnabled' | 'enqueuePdfGeneration'>
  >;

  beforeEach(() => {
    recordedSpans.length = 0;
    delete process.env.NODE_ENV;
    cloudTasks = {
      isEnabled: jest.fn(),
      enqueuePdfGeneration: jest.fn(),
    };
    const prisma = {
      client: {
        invoice: {
          findFirst: asyncMock().mockResolvedValue(invoiceRow),
          updateMany: asyncMock().mockResolvedValue({ count: 1 }),
        },
      },
    };
    service = new InvoicePdfService(
      prisma as unknown as PrismaService,
      {} as InvoicePdfRenderer,
      {} as PdfStorage,
      cloudTasks as unknown as CloudTasksService,
      {
        getTenantId: asyncMock().mockResolvedValue(tenantId),
      } as unknown as TenantContextService,
      undefined,
      {
        listAuthorizedSiteIds: asyncMock().mockResolvedValue(['site-1']),
      } as never,
    );
  });

  it('wraps the enqueue hand-off in invoice.pdf.enqueue with only the invoice id and outcome', async () => {
    cloudTasks.isEnabled.mockReturnValue(true);
    cloudTasks.enqueuePdfGeneration.mockResolvedValue({ taskId: 'task-1' });

    await service.requestGeneration(invoiceId, { targetBaseUrl });

    const handoff = recordedSpans.find(
      (span) => span.op === 'invoice.pdf.enqueue',
    );
    expect(handoff?.name).toBe('Enqueue invoice PDF');
    expect(handoff?.attributes).toEqual({ invoiceId });
    expect(handoff?.setAttribute).toHaveBeenCalledWith('outcome', 'enqueued');
    expect(cloudTasks.enqueuePdfGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'invoice',
        resourceId: invoiceId,
        tenantId,
        targetBaseUrl,
      }),
    );
  });
});
