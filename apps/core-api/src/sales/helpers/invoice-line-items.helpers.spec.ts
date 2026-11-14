import { BadRequestException } from '@nestjs/common';
import { DiscountType, Prisma } from '@prisma/client';
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

    expect(result.totalNet.toFixed(2)).toBe('70.00');
    expect(result.totalTax.toFixed(2)).toBe('3.80');
    expect(result.totalGross.toFixed(2)).toBe('73.80');
    expect(result.formattedItems).toEqual([
      expect.objectContaining({
        catalog_item_id: 'catalog-1',
        revenue_group_name: 'Parts',
      }),
      expect.objectContaining({
        catalog_item_id: undefined,
        revenue_group_name: null,
      }),
    ]);
  });

  it('Scenario 2: computes Prisma.Decimal totals matching snapshot for 1.5 x 12.99 and 2 x 10.03 at 20%', async () => {
    const result = await buildFormattedInvoiceItems(scoped, 'tenant-1', [
      {
        description: 'Part A',
        quantity: 1.5,
        unitPrice: 12.99,
        taxRate: 20,
      },
      {
        description: 'Part B1',
        quantity: 1,
        unitPrice: 10.03,
        taxRate: 20,
      },
      {
        description: 'Part B2',
        quantity: 1,
        unitPrice: 10.03,
        taxRate: 20,
      },
    ]);

    expect(result.totalNet.toFixed(2)).toBe('39.55');
    expect(result.totalTax.toFixed(2)).toBe('7.92');
    expect(result.totalGross.toFixed(2)).toBe('47.47');
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
        tax_rate: new Prisma.Decimal(0),
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
      buildFormattedInvoiceItems(scoped, 'tenant-1', [
        {
          catalogItemId: 'missing',
          description: 'Unknown part',
          quantity: 1,
          unitPrice: 10,
          taxRate: 20,
        },
      ]),
    ).rejects.toThrow(
      'Catalog item missing not found or belongs to another tenant',
    );
  });

  it('keeps the other same-catalog line discount when one line description changes', async () => {
    prisma.catalogItem.findMany.mockResolvedValue([
      {
        id: 'catalog-1',
        revenue_group: { name: 'Parts', tax_rate: new Prisma.Decimal(20) },
      },
    ]);

    const result = await buildFormattedInvoiceItems(
      scoped,
      'tenant-1',
      [
        {
          catalogItemId: 'catalog-1',
          description: 'Filter A edited',
          quantity: 1,
          unitPrice: 100,
          taxRate: 20,
        },
        {
          catalogItemId: 'catalog-1',
          description: 'Filter B',
          quantity: 1,
          unitPrice: 100,
          taxRate: 20,
        },
      ],
      {
        existingItems: [
          {
            catalog_item_id: 'catalog-1',
            workshop_task_line_item_id: null,
            description: 'Filter A',
            line_discount_type: DiscountType.PERCENTAGE,
            line_discount_value: new Prisma.Decimal(10),
          },
          {
            catalog_item_id: 'catalog-1',
            workshop_task_line_item_id: null,
            description: 'Filter B',
            line_discount_type: DiscountType.PERCENTAGE,
            line_discount_value: new Prisma.Decimal(25),
          },
        ],
      },
    );

    expect(result.formattedItems[0].line_discount_type).toBeNull();
    expect(result.formattedItems[0].line_discount_value).toBeNull();
    expect(result.formattedItems[1].line_discount_type).toBe(
      DiscountType.PERCENTAGE,
    );
    expect(result.formattedItems[1].line_discount_value).toEqual(
      new Prisma.Decimal(25),
    );
  });

  it('does not let a manual line steal a catalog line discount with the same description', async () => {
    const result = await buildFormattedInvoiceItems(
      scoped,
      'tenant-1',
      [
        {
          description: 'Shared description',
          quantity: 1,
          unitPrice: 100,
          taxRate: 20,
        },
      ],
      {
        existingItems: [
          {
            catalog_item_id: 'catalog-1',
            workshop_task_line_item_id: null,
            description: 'Shared description',
            line_discount_type: DiscountType.PERCENTAGE,
            line_discount_value: new Prisma.Decimal(15),
          },
        ],
      },
    );

    expect(result.formattedItems[0].line_discount_type).toBeNull();
    expect(result.formattedItems[0].line_discount_value).toBeNull();
  });
});
