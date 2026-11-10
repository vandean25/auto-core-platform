import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { reconcileDraftInvoiceItems } from './invoice-draft-reconciliation.helpers.js';

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

  it('keeps workshop line id on each row from the payload, independent of payload order', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      items: [],
    });

    await reconcileDraftInvoiceItems(tx as never, {
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      headerData: {
        customer_id: 'customer-1',
        total_net: 110,
        total_tax: 20,
        total_gross: 130,
      },
      formattedItems: [
        {
          tenant_id: 'tenant-1',
          description: 'Small exempt',
          quantity: 1,
          unit_price: 10,
          tax_rate: 0,
          workshop_task_line_item_id: 'wtl-small',
          revenue_group_name: null,
        },
        {
          tenant_id: 'tenant-1',
          description: 'Taxable labor',
          quantity: 1,
          unit_price: 100,
          tax_rate: 20,
          workshop_task_line_item_id: 'wtl-large',
          revenue_group_name: null,
        },
      ],
    });

    expect(tx.invoiceItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          workshop_task_line_item_id: 'wtl-small',
          tax_rate: 0,
          unit_price: 10,
        }),
        expect.objectContaining({
          workshop_task_line_item_id: 'wtl-large',
          tax_rate: 20,
          unit_price: 100,
        }),
      ],
    });
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
