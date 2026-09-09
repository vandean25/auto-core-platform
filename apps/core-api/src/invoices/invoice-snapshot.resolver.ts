import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { buildInvoiceSnapshot, type InvoiceSnapshot } from './invoice-snapshot';
import { isInvoiceSnapshot } from './invoice-snapshot.validation';

export async function resolveInvoiceSnapshot(
  prisma: PrismaService,
  invoiceId: string,
  existingSnapshot: unknown,
  tenantId: string,
): Promise<InvoiceSnapshot> {
  if (isInvoiceSnapshot(existingSnapshot)) {
    return existingSnapshot;
  }

  const fullInvoice = await prisma.client.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      customer: true,
      vehicle: true,
    },
  });

  if (!fullInvoice) {
    throw new NotFoundException('Invoice not found');
  }

  const snapshot = buildInvoiceSnapshot(fullInvoice);
  await prisma.client.invoice.updateMany({
    where: { id: invoiceId, tenant_id: tenantId },
    data: { snapshot },
  });

  return snapshot;
}
