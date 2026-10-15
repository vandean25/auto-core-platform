// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  addOneYearIsoDay,
  formatWarrantyDay,
  gewaehrleistungStatusBadge,
  negotiatedShorteningBlockReason,
  parseGarantieMonths,
  shorteningSaveErrorMessage,
} from './vehicle-sale-warranty'

function saveError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, data: { statusCode: status, message, code } })
}

describe('shorteningSaveErrorMessage', () => {
  it.each([
    'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
    'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
    'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
  ])('returns the server message for %s', (code) => {
    expect(shorteningSaveErrorMessage(saveError(422, code, 'Serverseitige Meldung'))).toBe('Serverseitige Meldung')
  })

  it('leaves other sale save failures to the generic feedback', () => {
    expect(
      shorteningSaveErrorMessage(saveError(422, 'GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE', 'Keine Regel')),
    ).toBeNull()
    expect(shorteningSaveErrorMessage(saveError(500, '', 'Something went wrong'))).toBeNull()
    expect(shorteningSaveErrorMessage(new Error('Network down'))).toBeNull()
  })
})

describe('addOneYearIsoDay', () => {
  it('adds one calendar year to an ISO day', () => {
    expect(addOneYearIsoDay('2025-10-08')).toBe('2026-10-08')
  })

  it('clamps 29 February to 28 February in a non-leap year', () => {
    expect(addOneYearIsoDay('2024-02-29')).toBe('2025-02-28')
  })
})

describe('negotiatedShorteningBlockReason', () => {
  const consumer = {
    buyerIsConsumer: true,
    firstRegistrationDate: '2020-10-08',
    handoverDate: '2026-10-08',
  }

  it('allows the negotiated shortening when first registration is more than a year before handover', () => {
    expect(negotiatedShorteningBlockReason(consumer)).toBeNull()
  })

  it('blocks the shortening when first registration is exactly one year before handover', () => {
    expect(
      negotiatedShorteningBlockReason({ ...consumer, firstRegistrationDate: '2025-10-08' }),
    ).toBe('Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.')
  })

  it('blocks the shortening when first registration is less than a year before handover', () => {
    expect(
      negotiatedShorteningBlockReason({ ...consumer, firstRegistrationDate: '2026-06-01' }),
    ).toBe('Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.')
  })

  it('blocks the shortening without a first registration date', () => {
    expect(
      negotiatedShorteningBlockReason({ ...consumer, firstRegistrationDate: null }),
    ).toBe('Für die Verkürzung ist das Datum der Erstzulassung erforderlich.')
  })

  it('blocks the shortening for a non-consumer buyer', () => {
    expect(
      negotiatedShorteningBlockReason({ ...consumer, buyerIsConsumer: false }),
    ).toBe('Eine Verkürzung setzt einen Verbraucherkauf voraus.')
  })

  it('does not block before a handover date exists, because the server computes nothing yet', () => {
    expect(
      negotiatedShorteningBlockReason({ ...consumer, handoverDate: '' }),
    ).toBeNull()
  })
})

describe('parseGarantieMonths', () => {
  it('treats an empty input as no Garantie block', () => {
    expect(parseGarantieMonths('')).toEqual({ value: null, valid: true })
    expect(parseGarantieMonths('   ')).toEqual({ value: null, valid: true })
  })

  it('accepts whole months between 1 and 120', () => {
    expect(parseGarantieMonths('12')).toEqual({ value: 12, valid: true })
    expect(parseGarantieMonths(' 6 ')).toEqual({ value: 6, valid: true })
    expect(parseGarantieMonths('120')).toEqual({ value: 120, valid: true })
  })

  it.each(['0', '121', '12.5', '-3', 'twelve'])('rejects %s', (raw) => {
    expect(parseGarantieMonths(raw)).toEqual({ value: null, valid: false })
  })
})

describe('gewaehrleistungStatusBadge', () => {
  it.each([
    ['ACTIVE', 'GEWAEHRLEISTUNG_ACTIVE', 'Aktiv'],
    ['EXPIRING_SOON', 'GEWAEHRLEISTUNG_EXPIRING_SOON', 'Läuft bald ab'],
    ['EXPIRED', 'GEWAEHRLEISTUNG_EXPIRED', 'Abgelaufen'],
  ] as const)('maps %s to a German badge', (status, badgeStatus, label) => {
    expect(gewaehrleistungStatusBadge(status)).toEqual({ status: badgeStatus, label })
  })
})

describe('formatWarrantyDay', () => {
  it('formats a stored date-only value as a German day without a time-zone shift', () => {
    expect(formatWarrantyDay('2026-10-14')).toBe('14.10.2026')
    expect(formatWarrantyDay('2026-10-14T00:00:00.000Z')).toBe('14.10.2026')
  })

  it('shows a dash for a missing date', () => {
    expect(formatWarrantyDay(null)).toBe('—')
    expect(formatWarrantyDay(undefined)).toBe('—')
  })
})
