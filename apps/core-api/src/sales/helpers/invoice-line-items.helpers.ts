import { BadRequestException } from '@nestjs/common';
import { Prisma, type CatalogItem, type RevenueGroup } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
export const DEFAULT_INVOICE_DUE_DAYS = 14;

export type InvoiceLineInput = {
  catalogItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
};

export type FormattedInvoiceItem =
  Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput;

export type InvoiceLineTotals = {
  formattedItems: FormattedInvoiceItem[];
  totalNet: number;
  totalTax: number;
  totalGross: number;
};

type CatalogItemWithRevenueGroup = CatalogItem & {
  revenue_group: RevenueGroup | null;
};

export function buildInvoiceDueDate(
  fromDate = new Date(),
  dueDays = DEFAULT_INVOICE_DUE_DAYS,
): Date {
  const dueDate = new Date(fromDate);
  dueDate.setDate(dueDate.getDate() + dueDays);
  return dueDate;
}

export function assertInvoiceHasItems(items: InvoiceLineInput[]): void {
  if (!items || items.length === 0) {
    throw new BadRequestException('Invoice must have at least one item');
  }
}

export async function buildFormattedInvoiceItems(
  prisma: Pick<PrismaService, 'catalogItem'>,
  tenantId: string,
  items: InvoiceLineInput[],
): Promise<InvoiceLineTotals> {
  assertInvoiceHasItems(items);

  const uniqueCatalogItemIds = [
    ...new Set(
      items
        .map((item) => item.catalogItemId)
        .filter(
          (catalogItemId): catalogItemId is string =>
            typeof catalogItemId === 'string',
        ),
    ),
  ];

  const catalogItemMap = new Map<string, CatalogItemWithRevenueGroup>();
  if (uniqueCatalogItemIds.length > 0) {
    const catalogItems = await prisma.catalogItem.findMany({
      where: { tenant_id: tenantId, id: { in: uniqueCatalogItemIds } },
      include: { revenue_group: true },
      orderBy: { id: 'asc' },
    });
    catalogItems.forEach((item) => catalogItemMap.set(item.id, item));
  }

  let totalNet = 0;
  let totalTax = 0;
  const formattedItems: FormattedInvoiceItem[] = [];

  for (const item of items) {
    let taxRate = item.taxRate;
    let revenueGroupName: string | null = null;

    if (item.catalogItemId) {
      const catalogItem = catalogItemMap.get(item.catalogItemId);
      if (!catalogItem) {
        throw new BadRequestException(
          `Catalog item ${item.catalogItemId} not found or belongs to another tenant`,
        );
      }
      if (catalogItem.revenue_group) {
        revenueGroupName = catalogItem.revenue_group.name;
        taxRate = Number(catalogItem.revenue_group.tax_rate);
      }
    }

    const net = item.quantity * item.unitPrice;
    const tax = net * (taxRate / 100);
    totalNet += net;
    totalTax += tax;

    formattedItems.push({
      tenant_id: tenantId,
      catalog_item_id: item.catalogItemId,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      tax_rate: taxRate,
      revenue_group_name: revenueGroupName,
    });
  }

  return {
    formattedItems,
    totalNet,
    totalTax,
    totalGross: totalNet + totalTax,
  };
}
