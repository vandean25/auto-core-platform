import type { Prisma } from '@prisma/client';

const VIENNA_TIME_ZONE = 'Europe/Vienna';

/** Calendar year of an instant in the Austrian business time zone (numbering, retention). */
export function calendarYearInVienna(instant: Date): number {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIENNA_TIME_ZONE,
    year: 'numeric',
  }).format(instant);
  return Number(formatted);
}

/**
 * KV-YYYY-XXXX from the tenant/year counter. Same atomic upsert-and-increment
 * as invoices and credit notes, so the number is consumed only when the
 * surrounding transaction commits.
 */
export async function generateWorkshopEstimateNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  year: number,
): Promise<string> {
  const sequence = await tx.workshopEstimateSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });
  return `KV-${year}-${sequence.current.toString().padStart(4, '0')}`;
}
