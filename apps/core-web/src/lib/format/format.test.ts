import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'

describe('lib/format (de-AT)', () => {
  it('formats numbers with Austrian grouping', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/\s/g, '.')).toBe(
      '1.234,5',
    )
  })

  it('formats EUR currency', () => {
    expect(formatCurrency(1234.5)).toMatch(/1\.234,50/)
    expect(formatCurrency(1234.5)).toMatch(/€|EUR/)
  })

  it('formats ISO calendar dates as DD.MM.YYYY in Vienna', () => {
    expect(formatDate('2026-10-16T12:00:00.000Z')).toBe('16.10.2026')
  })
})
