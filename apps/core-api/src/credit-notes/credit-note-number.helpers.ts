import { Prisma } from '@prisma/client';
import {
  calendarYearInTimeZone,
  resolveSiteTimeZone,
} from '../sales/helpers/invoice-number.helpers.js';

export interface GenerateCreditNoteNumberOptions {
  siteId?: string | null;
  timeZone?: string;
}

export async function generateCreditNoteNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  creditDate: Date,
  options?: GenerateCreditNoteNumberOptions,
): Promise<string> {
  const timeZone =
    options?.timeZone ??
    (await resolveSiteTimeZone(tx, tenantId, options?.siteId));
  const year = calendarYearInTimeZone(creditDate, timeZone);
  const prefix = `CN-${year}-`;

  const sequence = await tx.creditNoteSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });

  return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
}
