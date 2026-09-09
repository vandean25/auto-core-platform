import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { reconcileDraftInvoiceItems } from './invoice-draft-reconciliation.helpers';

describe('invoice-draft-reconciliation.helpers', () => {
  const tx = {
    invoice: {
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    invoiceItem: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replaces draft invoice items atomically', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      items: [{ id: 'line-1' }],
    });

    const result = await reconcileDraftInvoiceItems(tx as never, {
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      headerData: {
        customer_id: 'customer-1',
        total_net: 20,
        total_tax: 4,
        total_gross: 24,
      },
      formattedItems: [
        {
          tenant_id: 'tenant-1',
          description: 'Filter',
          quantity: 1,
          unit_price: 20,
          tax_rate: 20,
          revenue_group_name: null,
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(tx.invoiceItem.deleteMany).toHaveBeenCalledWith({
      where: { invoice_id: 'inv-1', tenant_id: 'tenant-1' },
    });
    expect(tx.invoiceItem.createMany).toHaveBeenCalled();
  });

  it('rejects updates when invoice is no longer draft', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      reconcileDraftInvoiceItems(tx as never, {
        invoiceId: 'inv-1',
        tenantId: 'tenant-1',
        headerData: {
          customer_id: 'customer-1',
          total_net: 20,
          total_tax: 4,
          total_gross: 24,
        },
        formattedItems: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when refreshed invoice is missing', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst.mockResolvedValue(null);

    await expect(
      reconcileDraftInvoiceItems(tx as never, {
        invoiceId: 'inv-1',
        tenantId: 'tenant-1',
        headerData: {
          customer_id: 'customer-1',
          total_net: 20,
          total_tax: 4,
          total_gross: 24,
        },
        formattedItems: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
