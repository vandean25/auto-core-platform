import { BadRequestException } from '@nestjs/common';
import {
  DiscountType,
  Prisma,
  type CatalogItem,
  type RevenueGroup,
} from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { computeStandardInvoiceTotals } from '../../invoices/invoice-snapshot-v2.js';
export const DEFAULT_INVOICE_DUE_DAYS = 14;

export type InvoiceLineInput = {
  catalogItemId?: string;
  workshopTaskLineItemId?: string;
  description: string;
  quantity: Prisma.Decimal | number | string;
  unitPrice: Prisma.Decimal | number | string;
  taxRate: Prisma.Decimal | number | string;
  lineDiscountType?: DiscountType | null;
  lineDiscountValue?: Prisma.Decimal | number | string | null;
};

export type ExistingDraftItemDiscountSource = {
  workshop_task_line_item_id?: string | null;
  catalog_item_id?: string | null;
  description?: string | null;
  line_discount_type?: DiscountType | null;
  line_discount_value?: Prisma.Decimal | null;
};

export type BuildFormattedInvoiceItemsOptions = {
  existingItems?: ExistingDraftItemDiscountSource[];
  globalDiscountType?: DiscountType | null;
  globalDiscountValue?: Prisma.Decimal | null;
};

export type FormattedInvoiceItem =
  Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput;

export type InvoiceLineTotals = {
  formattedItems: FormattedInvoiceItem[];
  totalNet: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalGross: Prisma.Decimal;
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

async function assertWorkshopLineItemsBelongToTenant(
  prisma: Pick<PrismaService, 'workshopTaskLineItem'>,
  tenantId: string,
  workshopLineIds: string[],
): Promise<void> {
  if (workshopLineIds.length === 0) {
    return;
  }

  const workshopLines = await prisma.workshopTaskLineItem.findMany({
    where: { tenant_id: tenantId, id: { in: workshopLineIds } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const foundIds = new Set(workshopLines.map((line) => line.id));

  for (const workshopLineId of workshopLineIds) {
    if (!foundIds.has(workshopLineId)) {
      throw new BadRequestException(
        `Workshop line item ${workshopLineId} not found or belongs to another tenant`,
      );
    }
  }
}

function consumeMatchingItemDiscount(
  item: InvoiceLineInput,
  pool: ExistingDraftItemDiscountSource[],
): {
  lineDiscountType: DiscountType | null;
  lineDiscountValue: Prisma.Decimal | null;
} {
  if (
    item.lineDiscountType &&
    item.lineDiscountValue !== undefined &&
    item.lineDiscountValue !== null
  ) {
    return {
      lineDiscountType: item.lineDiscountType,
      lineDiscountValue: new Prisma.Decimal(item.lineDiscountValue),
    };
  }
  const index = findMatchingExistingItemIndex(item, pool);
  if (index === -1) {
    return { lineDiscountType: null, lineDiscountValue: null };
  }
  const [matched] = pool.splice(index, 1);
  return {
    lineDiscountType: matched.line_discount_type ?? null,
    lineDiscountValue: matched.line_discount_value ?? null,
  };
}

function findMatchingExistingItemIndex(
  item: InvoiceLineInput,
  pool: ExistingDraftItemDiscountSource[],
): number {
  if (item.workshopTaskLineItemId) {
    return pool.findIndex(
      (candidate) =>
        candidate.workshop_task_line_item_id === item.workshopTaskLineItemId,
    );
  }
  if (item.catalogItemId) {
    const byCatalogAndDesc = pool.findIndex(
      (candidate) =>
        candidate.catalog_item_id === item.catalogItemId &&
        candidate.description === item.description,
    );
    if (byCatalogAndDesc !== -1) return byCatalogAndDesc;
    return pool.findIndex(
      (candidate) => candidate.catalog_item_id === item.catalogItemId,
    );
  }
  return pool.findIndex(
    (candidate) => candidate.description === item.description,
  );
}

export async function buildFormattedInvoiceItems(
  prisma: Pick<PrismaService, 'catalogItem' | 'workshopTaskLineItem'>,
  tenantId: string,
  items: InvoiceLineInput[],
  options?: BuildFormattedInvoiceItemsOptions,
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

  const uniqueWorkshopLineIds = [
    ...new Set(
      items
        .map((item) => item.workshopTaskLineItemId)
        .filter(
          (workshopLineId): workshopLineId is string =>
            typeof workshopLineId === 'string',
        ),
    ),
  ];

  await assertWorkshopLineItemsBelongToTenant(
    prisma,
    tenantId,
    uniqueWorkshopLineIds,
  );

  const existingPool = [...(options?.existingItems ?? [])];
  const formattedItems: FormattedInvoiceItem[] = [];
  const billedLines = items.map((item, index) => {
    let taxRate = new Prisma.Decimal(item.taxRate);
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
        taxRate = catalogItem.revenue_group.tax_rate;
      }
    }

    const quantity = new Prisma.Decimal(item.quantity);
    const unitPrice = new Prisma.Decimal(item.unitPrice);
    const { lineDiscountType, lineDiscountValue } = consumeMatchingItemDiscount(
      item,
      existingPool,
    );

    formattedItems.push({
      tenant_id: tenantId,
      catalog_item_id: item.catalogItemId,
      workshop_task_line_item_id: item.workshopTaskLineItemId ?? null,
      description: item.description,
      quantity,
      unit_price: unitPrice,
      tax_rate: taxRate,
      line_discount_type: lineDiscountType,
      line_discount_value: lineDiscountValue,
      line_total: quantity.mul(unitPrice),
      revenue_group_name: revenueGroupName,
    });

    return {
      id: `line-${index}`,
      quantity,
      unitPrice,
      taxRate,
      lineDiscountType,
      lineDiscountValue,
    };
  });

  const { totalNet, totalTax, totalGross } = computeStandardInvoiceTotals(
    billedLines,
    options?.globalDiscountType ?? null,
    options?.globalDiscountValue ?? null,
  );

  return {
    formattedItems,
    totalNet,
    totalTax,
    totalGross,
  };
}
