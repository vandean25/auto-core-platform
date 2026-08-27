import { describe, expect, it } from 'vitest'

import { buildDefaultDays, validateDays } from './work-schedule-form'

describe('work-schedule-form', () => {
  it('requires exactly seven unique weekdays', () => {
    expect(validateDays(buildDefaultDays())).toBeNull()

    const incomplete = buildDefaultDays().slice(0, 6)
    expect(validateDays(incomplete)).toBe('Work schedule must include exactly 7 weekdays')

    const duplicateWeekday = buildDefaultDays().map((day, index) => ({
      ...day,
      weekday: index === 0 ? 2 : day.weekday,
    }))
    expect(validateDays(duplicateWeekday)).toBe('Work schedule must include each weekday once')
  })

  it('rejects working days without times and non-working days with times', () => {
    const missingTimes = buildDefaultDays().map((day) =>
      day.weekday === 1 ? { ...day, startTime: null, endTime: null } : day,
    )
    expect(validateDays(missingTimes)).toBe('Monday requires start and end times')

    const extraTimes = buildDefaultDays().map((day) =>
      day.weekday === 6 ? { ...day, isWorking: false, startTime: '08:00', endTime: '12:00' } : day,
    )
    expect(validateDays(extraTimes)).toBe('Saturday must not include times when not working')
  })
})
