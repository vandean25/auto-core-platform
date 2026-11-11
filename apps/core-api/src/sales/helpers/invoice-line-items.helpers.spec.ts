import { BadRequestException } from '@nestjs/common';
import {
  assertInvoiceHasItems,
  buildFormattedInvoiceItems,
  buildInvoiceDueDate,
} from './invoice-line-items.helpers.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { fakePrisma } from './prisma-fake.spec.support.js';

describe('invoice-line-items.helpers', () => {
  const prisma = {
    catalogItem: {
      findMany: jest.fn(),
    },
    workshopTaskLineItem: {
      findMany: jest.fn(),
    },
  };
  const scoped = fakePrisma<
    Pick<PrismaService, 'catalogItem' | 'workshopTaskLineItem'>
  >(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.workshopTaskLineItem.findMany.mockResolvedValue([]);
  });

  it('rejects empty item lists', () => {
    expect(() => assertInvoiceHasItems([])).toThrow(BadRequestException);
  });

  it('builds due dates using the default window', () => {
    const fromDate = new Date('2026-01-01T00:00:00.000Z');
    const dueDate = buildInvoiceDueDate(fromDate);

    expect(dueDate.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('calculates totals and snapshots revenue groups', async () => {
    prisma.catalogItem.findMany.mockResolvedValue([
      {
        id: 'catalog-1',
        revenue_group: { name: 'Parts', tax_rate: 19 },
      },
    ]);

    const result = await buildFormattedInvoiceItems(scoped,'tenant-1', [
      {
        catalogItemId: 'catalog-1',
        description: 'Oil filter',
        quantity: 2,
        unitPrice: 10,
        taxRate: 20,
      },
      {
        description: 'Labor',
        quantity: 1,
        unitPrice: 50,
        taxRate: 0,
      },
    ]);

    expect(result.totalNet).toBe(70);
    expect(result.totalTax).toBe(3.8);
    expect(result.totalGross).toBe(73.8);
    expect(result.formattedItems).toEqual([
      expect.objectContaining({
        catalog_item_id: 'catalog-1',
        tax_rate: 19,
        revenue_group_name: 'Parts',
      }),
      expect.objectContaining({
        catalog_item_id: undefined,
        tax_rate: 0,
        revenue_group_name: null,
      }),
    ]);
  });

  it('passes workshopTaskLineItemId through to formatted invoice items', async () => {
    prisma.workshopTaskLineItem.findMany.mockResolvedValue([{ id: 'wtl-abc' }]);

    const result = await buildFormattedInvoiceItems(scoped, 'tenant-1', [
      {
        workshopTaskLineItemId: 'wtl-abc',
        description: 'Labor',
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ]);

    expect(result.formattedItems[0]).toEqual(
      expect.objectContaining({
        workshop_task_line_item_id: 'wtl-abc',
        tax_rate: 0,
      }),
    );
  });

  it('rejects an unknown workshop line id', async () => {
    prisma.workshopTaskLineItem.findMany.mockResolvedValue([]);

    await expect(
      buildFormattedInvoiceItems(scoped, 'tenant-1', [
        {
          workshopTaskLineItemId: 'wtl-unknown',
          description: 'Labor',
          quantity: 1,
          unitPrice: 100,
          taxRate: 0,
        },
      ]),
    ).rejects.toThrow(
      'Workshop line item wtl-unknown not found or belongs to another tenant',
    );
  });

  it('rejects a workshop line id that belongs to another tenant', async () => {
    prisma.workshopTaskLineItem.findMany.mockResolvedValue([]);

    await expect(
      buildFormattedInvoiceItems(scoped, 'tenant-1', [
        {
          workshopTaskLineItemId: '00000000-0000-4000-8000-00000000f0re',
          description: 'Labor',
          quantity: 1,
          unitPrice: 100,
          taxRate: 0,
        },
      ]),
    ).rejects.toThrow(/not found or belongs to another tenant/);
  });

  it('rejects catalog items that are missing from the tenant', async () => {
    prisma.catalogItem.findMany.mockResolvedValue([]);

    await expect(
      buildFormattedInvoiceItems(scoped,'tenant-1', [
        {
          catalogItemId: 'missing',
          description: 'Unknown part',
          quantity: 1,
          unitPrice: 10,
          taxRate: 20,
        },
      ]),
    ).rejects.toThrow('Catalog item missing not found or belongs to another tenant');
  });
});
