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

export function calendarDateInTimeZone(
  instant: Date,
  timeZone = DEFAULT_INVOICE_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseCalendarDateInTimeZone(
  value: string,
  timeZone = DEFAULT_INVOICE_TIME_ZONE,
): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      return null;
    }
    return parsed;
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return null;
  }
  return new Date(`${calendarDateInTimeZone(instant, timeZone)}T00:00:00.000Z`);
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

  const settings = tx.financeSettings?.findFirst
    ? await tx.financeSettings.findFirst({
        where: { tenant_id: tenantId },
        select: { id: true, invoice_prefix: true },
      })
    : null;

  const prefix = settings?.invoice_prefix ?? DEFAULT_INVOICE_PREFIX;
  const sequenceYear = prefix.includes('{YYYY}') ? year : 0;

  const sequence = await tx.invoiceSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year: sequenceYear } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year: sequenceYear, current: 1 },
  });

  if (settings && tx.financeSettings?.update) {
    await tx.financeSettings.update({
      where: { id: settings.id },
      data: { next_invoice_number: sequence.current + 1 },
    });
  }

  return formatInvoiceNumber(prefix, year, sequence.current);
}
