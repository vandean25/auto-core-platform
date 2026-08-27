import { describe, expect, it } from 'vitest'
import { localWallClockOnDate } from './planner-time'

describe('planner-time', () => {
  it('preserves local wall-clock time on a different date', () => {
    const source = new Date('2026-08-21T08:00:00.000Z')
    const moved = localWallClockOnDate(source, '2026-08-22', 'Europe/Vienna')

    expect(moved.toISOString()).toBe('2026-08-22T08:00:00.000Z')
  })
})
