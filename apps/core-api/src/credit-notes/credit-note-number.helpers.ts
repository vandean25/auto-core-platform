import { Prisma } from '@prisma/client';

export async function generateCreditNoteNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  creditDate: Date,
): Promise<string> {
  const year = creditDate.getFullYear();
  const prefix = `CN-${year}-`;

  const sequence = await tx.creditNoteSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });

  return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
}
