import { formatCurrency, formatDate, formatNumber } from '@/lib/format'

export function number(value: string | null | undefined, suffix = '', missing = '—'): string {
  return value == null
    ? missing
    : `${formatNumber(Number(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
}

/** The report period arrives as "2026-10-01 – 2026-10-27"; the screen shows it as dd.MM.yyyy (the CSV keeps the raw text). */
export function formatKpiPeriod(period: string): string {
  return period.replace(/\d{4}-\d{2}-\d{2}/g, (isoDate) => formatDate(isoDate, { timeZone: 'UTC' }))
}

/** Euro amount with the German grouping ("€ 23.500,00"), or the placeholder for a missing value. */
export function money(value: string | null | undefined, missing = '—'): string {
  return value == null ? missing : formatCurrency(value)
}

export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localIsoDate(date)
}
