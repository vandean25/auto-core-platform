import { getErrorCode, getErrorMessage } from '@/lib/error-utils'
import { formatStatusLabel } from '@/lib/i18n/enum-labels'
import { formatDateUtcMedium } from '@/lib/format'

/** Basisfrist status from the API: expired, expiring soon (due within 30 days), or active. */
export type GewaehrleistungStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED'

const GEWAEHRLEISTUNG_BADGE_STATUSES: Record<GewaehrleistungStatus, string> = {
  ACTIVE: 'GEWAEHRLEISTUNG_ACTIVE',
  EXPIRING_SOON: 'GEWAEHRLEISTUNG_EXPIRING_SOON',
  EXPIRED: 'GEWAEHRLEISTUNG_EXPIRED',
}

/** The shared StatusBadge key and localized label for a Gewährleistung status. */
export function gewaehrleistungStatusBadge(status: GewaehrleistungStatus) {
  const badgeStatus = GEWAEHRLEISTUNG_BADGE_STATUSES[status]
  return { status: badgeStatus, label: formatStatusLabel(badgeStatus) }
}

/** A stored date-only value (`YYYY-MM-DD`) as a German day, e.g. `14.10.2026`. */
export function formatWarrantyDay(value: string | null | undefined): string {
  if (!value) return '—'
  return formatDateUtcMedium(`${value.slice(0, 10)}T00:00:00Z`)
}

export const GARANTIE_MONTHS_MIN = 1
export const GARANTIE_MONTHS_MAX = 120

/**
 * Adds one calendar year to an ISO day (`YYYY-MM-DD`). 29 February becomes
 * 28 February in a non-leap year, matching the server's anniversary rule.
 */
export function addOneYearIsoDay(isoDay: string): string {
  const [year, month, day] = isoDay.split('-').map(Number)
  const targetYear = year + 1
  const lastDayOfMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  const clampedDay = Math.min(day, lastDayOfMonth)
  return [
    String(targetYear).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(clampedDay).padStart(2, '0'),
  ].join('-')
}

/**
 * Client-side explanation of the negotiated one-year period guard. The server
 * stays authoritative and returns the same rule on save. This only prevents a
 * save that the server would refuse.
 */
export function negotiatedShorteningBlockReason(input: {
  buyerIsConsumer: boolean
  firstRegistrationDate: string | null
  handoverDate: string
}): string | null {
  if (!input.buyerIsConsumer) {
    return 'Eine Verkürzung setzt einen Verbraucherkauf voraus.'
  }
  if (!input.firstRegistrationDate) {
    return 'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.'
  }
  if (!input.handoverDate) {
    return null
  }
  const firstAnniversary = addOneYearIsoDay(input.firstRegistrationDate.slice(0, 10))
  if (firstAnniversary >= input.handoverDate.slice(0, 10)) {
    return 'Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.'
  }
  return null
}

/** Parses the Garantie duration input. An empty input means no Garantie block. */
export function parseGarantieMonths(raw: string): { value: number | null; valid: boolean } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { value: null, valid: true }
  }
  const parsed = Number(trimmed)
  const valid =
    Number.isInteger(parsed) && parsed >= GARANTIE_MONTHS_MIN && parsed <= GARANTIE_MONTHS_MAX
  return { value: valid ? parsed : null, valid }
}

const SHORTENING_REJECTION_CODES = new Set([
  'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
  'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
  'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
])

/** The backend's German reason when a sale save refuses the negotiated shortening, otherwise null. */
export function shorteningSaveErrorMessage(error: unknown): string | null {
  const code = getErrorCode(error)
  if (!code || !SHORTENING_REJECTION_CODES.has(code)) return null
  return getErrorMessage(error, '') || null
}
