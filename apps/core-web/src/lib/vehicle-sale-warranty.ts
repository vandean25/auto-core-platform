export const GARANTIE_MONTHS_MIN = 1
export const GARANTIE_MONTHS_MAX = 120
export const GARANTIE_MONTHS_MESSAGE = 'Bitte eine Dauer zwischen 1 und 120 Monaten angeben.'

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
