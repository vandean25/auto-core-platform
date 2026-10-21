import { FORMAT_LOCALE } from '@/lib/i18n/constants'

/** Austrian thousands separator is always `.` (spec), not ICU narrow no-break space. */
function formatPartsToAustrianString(parts: Intl.NumberFormatPart[]): string {
  return parts
    .map((part) => {
      if (part.type === 'group') {
        return '.'
      }
      return part.value
    })
    .join('')
}

export function formatWithIntlNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const parts = new Intl.NumberFormat(FORMAT_LOCALE, options).formatToParts(value)
  return formatPartsToAustrianString(parts)
}

export function formatWithIntlCurrency(value: number, currency: string): string {
  const parts = new Intl.NumberFormat(FORMAT_LOCALE, { style: 'currency', currency }).formatToParts(
    value,
  )
  return formatPartsToAustrianString(parts)
}

export function formatWithIntlDateTime(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(FORMAT_LOCALE, options).format(date)
}

export function formatWithIntlDateTimeInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(FORMAT_LOCALE, { ...options, timeZone }).format(date)
}

export function formatToPartsInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat(FORMAT_LOCALE, { ...options, timeZone }).formatToParts(date)
}

export function resolvedSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function localeCompareDisplay(a: string, b: string): number {
  return a.localeCompare(b, FORMAT_LOCALE)
}

export function normalizeForSearch(value: string): string {
  return value.toLocaleLowerCase(FORMAT_LOCALE)
}
