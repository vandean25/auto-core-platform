import { Prisma } from '@prisma/client';

export const DEFAULT_INVOICE_PREFIX = 'RE-{YYYY}-';
export const DEFAULT_NEXT_INVOICE_NUMBER = 1;
export const DEFAULT_INVOICE_TIME_ZONE = 'Europe/Vienna';

export function calendarYearInTimeZone(
  instant: Date,
  timeZone = DEFAULT_INVOICE_TIME_ZONE,
): number {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
  }).format(instant);
  return Number(formatted);
}

export function formatInvoiceNumber(
  prefix: string,
  year: number,
  sequenceNumber: number,
): string {
  const resolvedPrefix = prefix.replaceAll('{YYYY}', String(year));
  return `${resolvedPrefix}${String(sequenceNumber).padStart(4, '0')}`;
}

export async function resolveSiteTimeZone(
  db: Pick<Prisma.TransactionClient, 'site'>,
  tenantId: string,
  siteId?: string | null,
): Promise<string> {
  if (!siteId || !db.site?.findFirst) {
    return DEFAULT_INVOICE_TIME_ZONE;
  }
  const site = await db.site.findFirst({
    where: { id: siteId, tenant_id: tenantId },
    select: { timezone: true },
  });
  return site?.timezone || DEFAULT_INVOICE_TIME_ZONE;
}

export interface GenerateInvoiceNumberOptions {
  siteId?: string | null;
  now?: Date;
}

export async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  options?: GenerateInvoiceNumberOptions,
): Promise<string> {
  const timeZone = await resolveSiteTimeZone(tx, tenantId, options?.siteId);
  const year = calendarYearInTimeZone(options?.now ?? new Date(), timeZone);

  const sequence = await tx.invoiceSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });

  const settings = tx.financeSettings?.findFirst
    ? await tx.financeSettings.findFirst({
        where: { tenant_id: tenantId },
        select: { id: true, invoice_prefix: true },
      })
    : null;

  const prefix = settings?.invoice_prefix ?? DEFAULT_INVOICE_PREFIX;

  if (settings && tx.financeSettings?.update) {
    await tx.financeSettings.update({
      where: { id: settings.id },
      data: { next_invoice_number: sequence.current + 1 },
    });
  }

  return formatInvoiceNumber(prefix, year, sequence.current);
}
