import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import type { FormattedInvoiceItem } from './invoice-line-items.helpers.js';

export async function reconcileDraftInvoiceItems(
  tx: Prisma.TransactionClient,
  params: {
    invoiceId: string;
    tenantId: string;
    headerData: {
      customer_id: string;
      vehicle_id?: string | null;
      notes?: string | null;
      internal_notes?: string | null;
      total_net: number;
      total_tax: number;
      total_gross: number;
    };
    formattedItems: FormattedInvoiceItem[];
  },
) {
  const updateResult = await tx.invoice.updateMany({
    where: {
      id: params.invoiceId,
      tenant_id: params.tenantId,
      status: InvoiceStatus.DRAFT,
    },
    data: params.headerData,
  });
  if (updateResult.count === 0) {
    throw new BadRequestException('Only DRAFT invoices can be updated');
  }

  const existingItems = await tx.invoiceItem.findMany({
    where: { invoice_id: params.invoiceId, tenant_id: params.tenantId },
    orderBy: { id: 'asc' },
    select: { workshop_task_line_item_id: true },
  });

  const itemsToCreate = params.formattedItems.map((item, index) => {
    const priorWorkshopLineId =
      existingItems[index]?.workshop_task_line_item_id;
    const workshopTaskLineItemId =
      item.workshop_task_line_item_id ?? priorWorkshopLineId ?? null;

    return {
      ...item,
      workshop_task_line_item_id: workshopTaskLineItemId,
      invoice_id: params.invoiceId,
    };
  });

  await tx.invoiceItem.deleteMany({
    where: { invoice_id: params.invoiceId, tenant_id: params.tenantId },
  });
  await tx.invoiceItem.createMany({
    data: itemsToCreate,
  });

  const updated = await tx.invoice.findFirst({
    where: { id: params.invoiceId, tenant_id: params.tenantId },
    include: { items: true },
  });
  if (!updated) {
    throw new NotFoundException('Invoice not found');
  }

  return updated;
}
