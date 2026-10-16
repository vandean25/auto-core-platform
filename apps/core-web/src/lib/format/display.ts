import { i18n } from '@/lib/i18n/init-i18n'
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/constants'
import {
  formatToPartsInZone,
  formatWithIntlCurrency,
  formatWithIntlDateTime,
  formatWithIntlDateTimeInZone,
  formatWithIntlNumber,
} from './intl-private'
import { parseFiniteNumber, parseIsoDateOnly, toDate } from './parse'

function missingPlaceholder(): string {
  return i18n.t('common:placeholders.missing')
}

function unknownPlaceholder(): string {
  return i18n.t('common:placeholders.unknown')
}

export function formatNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  const parsed = parseFiniteNumber(value)
  if (parsed == null) {
    return missingPlaceholder()
  }
  return formatWithIntlNumber(parsed, options)
}

export function formatCurrency(
  amount: number | string | null | undefined,
  currency = 'EUR',
): string {
  const parsed = parseFiniteNumber(amount)
  if (parsed == null) {
    return missingPlaceholder()
  }
  return formatWithIntlCurrency(parsed, currency)
}

export function formatPercent(
  value: number | null | undefined,
  options?: { maximumFractionDigits?: number },
): string {
  if (value == null || !Number.isFinite(value)) {
    return missingPlaceholder()
  }
  const formatted = formatWithIntlNumber(value, {
    maximumFractionDigits: options?.maximumFractionDigits ?? 1,
  })
  return `${formatted} %`
}

export function formatDate(
  value: Date | string | null | undefined,
  options?: { timeZone?: string },
): string {
  const date = toDate(value)
  if (!date) {
    return missingPlaceholder()
  }
  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE
  return formatWithIntlDateTimeInZone(date, timeZone, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateShort(
  value: Date | string | null | undefined,
  options?: { timeZone?: string },
): string {
  const date = toDate(value)
  if (!date) {
    return missingPlaceholder()
  }
  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE
  return formatWithIntlDateTimeInZone(date, timeZone, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatIsoDateTimeInZone(
  value: Date | string | number | null | undefined,
  timeZone: string,
): string | null {
  const date =
    typeof value === 'number'
      ? new Date(value)
      : toDate(value)
  if (!date || Number.isNaN(date.getTime())) {
    return null
  }
  const parts = Object.fromEntries(
    formatToPartsInZone(date, timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

export function formatDateUtcMedium(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) {
    return missingPlaceholder()
  }
  return formatWithIntlDateTime(date, { dateStyle: 'medium', timeZone: 'UTC' })
}

export function formatDateTime(
  value: Date | string | null | undefined,
  options?: { timeZone?: string },
): string {
  const date = toDate(value)
  if (!date) {
    return missingPlaceholder()
  }
  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE
  return formatWithIntlDateTimeInZone(date, timeZone, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTimeInZone(
  isoInstant: string | null | undefined,
  timeZone: string,
): string | null {
  const date = toDate(isoInstant)
  if (!date) {
    return null
  }
  return formatWithIntlDateTimeInZone(date, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

export function formatHours(value: number, suffix = ' h'): string {
  return `${formatWithIntlNumber(value, { maximumFractionDigits: 2 })}${suffix}`
}

export function formatDateLabel(isoDate: string, timeZone: string): string {
  const { year, month, day } = parseIsoDateOnly(isoDate)
  const utc = Date.UTC(year, month - 1, day, 12, 0, 0)
  return formatWithIntlDateTimeInZone(new Date(utc), timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatMonthYear(date: Date, timeZone: string): string {
  return formatWithIntlDateTimeInZone(date, timeZone, { month: 'long', year: 'numeric' })
}

export function formatRelativeMinutes(minutes: number): string {
  const count = Math.max(0, Math.round(minutes))
  return i18n.t('common:relative.minutesAgo', { count })
}

export function formatUnknownValue(): string {
  return unknownPlaceholder()
}

export function formatOdometerKm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return missingPlaceholder()
  }
  return `${formatWithIntlNumber(value)} km`
}
