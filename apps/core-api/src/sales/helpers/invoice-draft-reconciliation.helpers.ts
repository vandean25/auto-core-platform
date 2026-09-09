import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import type { FormattedInvoiceItem } from './invoice-line-items.helpers';

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

  await tx.invoiceItem.deleteMany({
    where: { invoice_id: params.invoiceId, tenant_id: params.tenantId },
  });
  await tx.invoiceItem.createMany({
    data: params.formattedItems.map((item) => ({
      ...item,
      invoice_id: params.invoiceId,
    })),
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
