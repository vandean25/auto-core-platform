// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  averageExpectedMinutesPerWorkday,
  daysToMinutes,
  FALLBACK_AVG_WORKDAY_MINUTES,
  approxLeaveDays,
  workdayMinutesFromTimes,
} from './hr-leave-minutes'

const standardWeek: Array<{
  isWorking: boolean
  startTime: string | null
  endTime: string | null
  breakMinutes: number
}> = [
  { isWorking: true, startTime: '07:30', endTime: '17:00', breakMinutes: 0 },
  { isWorking: true, startTime: '07:30', endTime: '17:00', breakMinutes: 0 },
  { isWorking: true, startTime: '07:30', endTime: '17:00', breakMinutes: 0 },
  { isWorking: true, startTime: '07:30', endTime: '17:00', breakMinutes: 0 },
  { isWorking: true, startTime: '07:30', endTime: '17:00', breakMinutes: 0 },
  { isWorking: false, startTime: null, endTime: null, breakMinutes: 0 },
  { isWorking: false, startTime: null, endTime: null, breakMinutes: 0 },
]

describe('hr-leave-minutes', () => {
  it('computes workday minutes from door-to-door times', () => {
    expect(workdayMinutesFromTimes('07:30', '17:00', 0)).toBe(570)
    expect(workdayMinutesFromTimes('08:00', '12:30', 30)).toBe(240)
  })

  it('averages working weekdays and falls back when none are working', () => {
    expect(averageExpectedMinutesPerWorkday(standardWeek)).toBe(570)
    expect(
      averageExpectedMinutesPerWorkday(
        standardWeek.map((day) => ({ ...day, isWorking: false, startTime: null, endTime: null })),
      ),
    ).toBe(FALLBACK_AVG_WORKDAY_MINUTES)
  })

  it('converts days to minutes using the average workday', () => {
    expect(daysToMinutes(25, 515)).toBe(12875)
  })

  it('converts leave minutes to days with one decimal, or null without a workday length', () => {
    expect(approxLeaveDays(10025, 515)).toBe(19.5)
    expect(approxLeaveDays(12875, 515)).toBe(25)
    expect(approxLeaveDays(12875, 480)).toBe(26.8)
    expect(approxLeaveDays(500, 0)).toBeNull()
  })
})
