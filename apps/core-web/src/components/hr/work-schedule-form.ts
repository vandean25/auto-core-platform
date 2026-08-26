import type { EmployeeWorkScheduleDay } from '@/api/hr'

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

export const DEFAULT_WORKING_DAY: Omit<EmployeeWorkScheduleDay, 'weekday'> = {
  isWorking: true,
  startTime: '07:30',
  endTime: '17:00',
  breakMinutes: 0,
}

export const DEFAULT_NON_WORKING_DAY: Omit<EmployeeWorkScheduleDay, 'weekday'> = {
  isWorking: false,
  startTime: null,
  endTime: null,
  breakMinutes: 0,
}

export type ScheduleDayFormState = EmployeeWorkScheduleDay

export function buildDefaultDays(): ScheduleDayFormState[] {
  return ISO_WEEKDAYS.map((weekday) => ({
    weekday,
    ...(weekday <= 5 ? DEFAULT_WORKING_DAY : DEFAULT_NON_WORKING_DAY),
  }))
}

export function daysFromVersion(
  days: Array<{
    weekday: number
    isWorking: boolean
    startTime: string | null
    endTime: string | null
    breakMinutes: number
  }>,
): ScheduleDayFormState[] {
  const byWeekday = new Map(days.map((day) => [day.weekday, day]))
  return ISO_WEEKDAYS.map((weekday) => {
    const existing = byWeekday.get(weekday)
    if (!existing) {
      return { weekday, ...DEFAULT_NON_WORKING_DAY }
    }
    return {
      weekday,
      isWorking: existing.isWorking,
      startTime: existing.startTime,
      endTime: existing.endTime,
      breakMinutes: existing.breakMinutes,
    }
  })
}

export function normalizeDaysForSubmit(days: ScheduleDayFormState[]): EmployeeWorkScheduleDay[] {
  return days.map((day) => {
    if (!day.isWorking) {
      return {
        weekday: day.weekday,
        isWorking: false,
        startTime: null,
        endTime: null,
        breakMinutes: 0,
      }
    }

    return {
      weekday: day.weekday,
      isWorking: true,
      startTime: day.startTime,
      endTime: day.endTime,
      breakMinutes: day.breakMinutes,
    }
  })
}

export function validateDays(days: ScheduleDayFormState[]): string | null {
  if (days.length !== 7) {
    return 'Work schedule must include exactly 7 weekdays'
  }

  const weekdays = new Set(days.map((day) => day.weekday))
  if (weekdays.size !== 7) {
    return 'Work schedule must include each weekday once'
  }

  for (const day of days) {
    if (!day.isWorking) {
      if (day.startTime || day.endTime) {
        return `${WEEKDAY_LABELS[day.weekday]} must not include times when not working`
      }
      continue
    }

    if (!day.startTime || !day.endTime) {
      return `${WEEKDAY_LABELS[day.weekday]} requires start and end times`
    }

    const [startHour, startMinute] = day.startTime.split(':').map(Number)
    const [endHour, endMinute] = day.endTime.split(':').map(Number)
    const grossSpan = endHour * 60 + endMinute - (startHour * 60 + startMinute)
    if (grossSpan <= 0) {
      return `${WEEKDAY_LABELS[day.weekday]} end time must be after start time`
    }
    if (day.breakMinutes < 0 || day.breakMinutes >= grossSpan) {
      return `${WEEKDAY_LABELS[day.weekday]} break must be shorter than the workday`
    }
  }

  return null
}
