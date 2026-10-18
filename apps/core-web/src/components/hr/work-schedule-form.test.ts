// @vitest-environment node
import { describe, expect, it } from 'vitest'

import deHr from '../../../../../locales/de/hr.json'
import { buildDefaultDays, validateDays } from './work-schedule-form'

describe('work-schedule-form', () => {
  it('requires exactly seven unique weekdays', () => {
    expect(validateDays(buildDefaultDays())).toBeNull()

    const incomplete = buildDefaultDays().slice(0, 6)
    expect(validateDays(incomplete)).toBe(deHr.workSchedule.validation.mustHaveSevenDays)

    const duplicateWeekday = buildDefaultDays().map((day, index) => ({
      ...day,
      weekday: index === 0 ? 2 : day.weekday,
    }))
    expect(validateDays(duplicateWeekday)).toBe(deHr.workSchedule.validation.eachWeekdayOnce)
  })

  it('rejects working days without times and non-working days with times', () => {
    const missingTimes = buildDefaultDays().map((day) =>
      day.weekday === 1 ? { ...day, startTime: null, endTime: null } : day,
    )
    expect(validateDays(missingTimes)).toBe(
      deHr.workSchedule.validation.requiresTimes.replace('{{day}}', deHr.workSchedule.weekdays['1']),
    )

    const extraTimes = buildDefaultDays().map((day) =>
      day.weekday === 6 ? { ...day, isWorking: false, startTime: '08:00', endTime: '12:00' } : day,
    )
    expect(validateDays(extraTimes)).toBe(
      deHr.workSchedule.validation.noTimesWhenNotWorking.replace('{{day}}', deHr.workSchedule.weekdays['6']),
    )
  })
})
