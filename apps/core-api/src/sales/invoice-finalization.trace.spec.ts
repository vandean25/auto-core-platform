import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, Prisma, SalesOrderStatus } from '@prisma/client';
import type { AtpService } from '../inventory/atp.service.js';
import type { InvoiceSnapshotCommitService } from '../invoices/invoice-snapshot-commit.service.js';

function asyncMock() {
  return jest.fn<(args: unknown) => Promise<unknown>>();
}

const mockStartSpan = jest.fn();
const mockGetClient = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  startSpan: mockStartSpan,
  getClient: mockGetClient,
  getActiveSpan: jest.fn(),
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
  getTraceData: jest.fn(),
}));

const { InvoiceFinalizationService } = await import(
  './invoice-finalization.service.js'
);

describe('InvoiceFinalizationService span', () => {
  const span = { setAttribute: jest.fn(), setAttributes: jest.fn() };

  const atpService = {
    calculateAtp: jest.fn(
      (stock: {
        quantity_on_hand: Prisma.Decimal | number;
        quantity_reserved: Prisma.Decimal | number;
      }) => ({
        quantityAvailable: new Prisma.Decimal(stock.quantity_on_hand).sub(
          stock.quantity_reserved,
        ),
      }),
    ),
    deductOnHandForSale: jest.fn(),
  } as unknown as AtpService;

  const snapshotCommit = {
    prepareV2Snapshot: jest.fn(async () => ({
      snapshot: { schema_version: 2 },
      ownership: { siteId: 'site-1', legalEntityId: 'le-1' },
      dueDate: new Date(),
      supplyFrom: new Date(),
      supplyTo: new Date(),
    })),
    persistV2Snapshot: jest.fn(async () => undefined),
  } as unknown as InvoiceSnapshotCommitService;

  const tx = {
    $queryRaw: jest.fn(async () => []),
    invoiceSequence: { upsert: jest.fn(async () => ({ current: 1 })) },
    inventoryStock: {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    inventoryTransaction: { createMany: jest.fn() },
    invoice: { updateMany: asyncMock(), findFirst: asyncMock() },
    salesOrder: { findFirst: asyncMock(), updateMany: asyncMock() },
  };

  const draftInvoice = {
    id: 'inv-1',
    sales_order_id: 'so-1',
    status: InvoiceStatus.DRAFT,
    items: [],
  };

  beforeEach(() => {
    mockStartSpan.mockReset();
    mockGetClient.mockReset();
    mockGetClient.mockReturnValue({});
    span.setAttribute.mockReset();
    span.setAttributes.mockReset();
    mockStartSpan.mockImplementation((_options, callback) =>
      (callback as (s: unknown) => unknown)(span),
    );
    tx.invoice.findFirst.mockReset();
    tx.invoice.updateMany.mockReset();
    tx.salesOrder.findFirst.mockReset();
    tx.salesOrder.updateMany.mockReset();
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.salesOrder.findFirst.mockResolvedValue({
      status: SalesOrderStatus.COMPLETED,
    });
  });

  it('runs under invoice.finalize with only the invoice id, and records the finalized outcome', async () => {
    tx.invoice.findFirst
      .mockResolvedValueOnce({
        ...draftInvoice,
        customer: { id: 'customer-1' },
        vehicle: null,
      })
      .mockResolvedValueOnce({
        id: 'inv-1',
        status: InvoiceStatus.FINALIZED,
        items: [],
        customer: { id: 'customer-1' },
      });
    const service = new InvoiceFinalizationService(atpService, snapshotCommit);

    await service.finalizeInTransaction(tx as never, 'tenant-1', draftInvoice as never);

    expect(mockStartSpan).toHaveBeenCalledWith(
      {
        name: 'Finalize invoice',
        op: 'invoice.finalize',
        attributes: { invoiceId: 'inv-1' },
      },
      expect.any(Function),
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'step',
      'transition_sales_order',
    );
    expect(span.setAttribute).toHaveBeenCalledWith('outcome', 'finalized');
  });

  it('records a 4xx business rejection as rejected and rethrows it', async () => {
    const service = new InvoiceFinalizationService(atpService, snapshotCommit);

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', {
        ...draftInvoice,
        sales_order_id: null,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(span.setAttribute).toHaveBeenCalledWith('outcome', 'rejected');
  });

  it('records a database failure as failed at the step that broke', async () => {
    tx.invoice.findFirst.mockRejectedValueOnce(new Error('connection lost'));
    const service = new InvoiceFinalizationService(atpService, snapshotCommit);

    await expect(
      service.finalizeInTransaction(tx as never, 'tenant-1', draftInvoice as never),
    ).rejects.toThrow('connection lost');

    expect(span.setAttribute).toHaveBeenCalledWith('step', 'load_invoice');
    expect(span.setAttribute).toHaveBeenCalledWith('outcome', 'failed');
  });
});
