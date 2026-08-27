import { describe, expect, it } from 'vitest'
import { buildSlots, getEffectiveHours } from './planner-hours'

const weekdayOpenings = [
  { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
]

describe('planner-hours', () => {
  it('uses short holiday hours instead of weekday openings', () => {
    const hours = getEffectiveHours('2026-08-21', weekdayOpenings, [
      {
        date: '2026-08-21',
        name: 'Bridge day',
        isClosed: false,
        openTime: '10:00',
        closeTime: '14:00',
      },
    ])

    expect(hours.isClosed).toBe(false)
    expect(hours.openTime).toBe('10:00')
    expect(hours.closeTime).toBe('14:00')
    expect(hours.holidayName).toBe('Bridge day')
  })

  it('builds slots from short holiday hours', () => {
    const hours = getEffectiveHours('2026-08-21', weekdayOpenings, [
      {
        date: '2026-08-21',
        name: 'Bridge day',
        isClosed: false,
        openTime: '10:00',
        closeTime: '12:00',
      },
    ])

    const slots = buildSlots(hours, 60, 'Europe/Vienna', '2026-08-21')
    expect(slots).toHaveLength(2)
    expect(slots[0].label).toBe('10:00')
    expect(slots[1].label).toBe('11:00')
  })
})
