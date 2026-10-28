import { describe, expect, it } from 'vitest'

import { hasUtcDayChanged } from './date-utils'

describe('hasUtcDayChanged', () => {
  const at = (iso: string) => new Date(iso).getTime()

  it('is false within the same UTC day and true after midnight UTC', () => {
    expect(hasUtcDayChanged(at('2026-10-28T00:00:00.000Z'), at('2026-10-28T23:59:59.999Z'))).toBe(false)
    expect(hasUtcDayChanged(at('2026-10-28T23:59:59.999Z'), at('2026-10-29T00:00:00.000Z'))).toBe(true)
  })

  it('detects a month and a year boundary', () => {
    expect(hasUtcDayChanged(at('2026-10-31T12:00:00.000Z'), at('2026-11-01T12:00:00.000Z'))).toBe(true)
    expect(hasUtcDayChanged(at('2026-12-31T23:00:00.000Z'), at('2027-01-01T01:00:00.000Z'))).toBe(true)
  })
})
