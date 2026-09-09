import { Prisma } from '@prisma/client';

export async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `RE-${year}-`;

  const sequence = await tx.invoiceSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });

  return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
}
