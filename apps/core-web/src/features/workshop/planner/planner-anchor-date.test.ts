// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { initialPlannerAnchorDate, isPlannerDateSearchParam } from './planner-anchor-date'

describe('planner-anchor-date', () => {
  it('accepts YYYY-MM-DD date params', () => {
    expect(isPlannerDateSearchParam('2026-08-21')).toBe(true)
    expect(isPlannerDateSearchParam('2026-8-21')).toBe(false)
    expect(isPlannerDateSearchParam(null)).toBe(false)
  })

  it('uses the date param when valid', () => {
    expect(initialPlannerAnchorDate('2026-08-21', 'Europe/Vienna')).toBe('2026-08-21')
  })

  it('falls back to today in the tenant timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z'))
    expect(initialPlannerAnchorDate(null, 'Europe/Vienna')).toBe('2026-08-21')
    vi.useRealTimers()
  })
})
