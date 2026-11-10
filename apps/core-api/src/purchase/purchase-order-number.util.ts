import type { Prisma } from '@prisma/client';

/**
 * PO-YYYY-NNNN from the tenant/year counter. Same atomic upsert-and-increment
 * as invoices and workshop estimates, so the number is consumed only when the
 * surrounding transaction commits.
 */
export async function allocatePurchaseOrderNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  const sequence = await tx.purchaseOrderSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });
  return `PO-${year}-${sequence.current.toString().padStart(4, '0')}`;
}
