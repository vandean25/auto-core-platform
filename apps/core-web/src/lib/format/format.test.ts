import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatIsoDateOnly, formatNumber } from '@/lib/format'
import { zonedWallClockToUtc } from '@/lib/format/timezone'

describe('lib/format (de-AT)', () => {
  it('formats numbers with Austrian grouping', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe('1.234,5')
  })

  it('formats EUR currency', () => {
    expect(formatCurrency(1234.5)).toMatch(/1\.234,50/)
    expect(formatCurrency(1234.5)).toMatch(/€|EUR/)
  })

  it('formats ISO calendar dates as DD.MM.YYYY in Vienna', () => {
    expect(formatDate('2026-10-16T12:00:00.000Z')).toBe('16.10.2026')
  })

  it('formats date-only ISO strings without timezone day shift', () => {
    expect(formatIsoDateOnly('2026-08-24')).toBe('24.08.2026')
  })
})

describe('lib/format timezone (Europe/Vienna)', () => {
  it('converts spring-forward wall clock across the DST gap', () => {
    const instant = zonedWallClockToUtc('Europe/Vienna', 2026, 3, 29, 1, 30)
    expect(instant.toISOString()).toBe('2026-03-29T00:30:00.000Z')
  })
})
