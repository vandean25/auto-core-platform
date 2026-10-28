export const FALLBACK_AVG_WORKDAY_MINUTES = 480

export type WorkScheduleDayLike = {
  isWorking: boolean
  startTime: string | null
  endTime: string | null
  breakMinutes: number
}

export function workdayMinutesFromTimes(
  startTime: string,
  endTime: string,
  breakMinutes: number,
): number {
  const [openHour, openMinute] = startTime.split(':').map(Number)
  const [closeHour, closeMinute] = endTime.split(':').map(Number)
  const grossSpan = closeHour * 60 + closeMinute - (openHour * 60 + openMinute)
  if (grossSpan <= 0 || breakMinutes < 0 || breakMinutes >= grossSpan) {
    return 0
  }
  return grossSpan - breakMinutes
}

export function averageExpectedMinutesPerWorkday(days: WorkScheduleDayLike[]): number {
  const working = days.filter((day) => day.isWorking)
  if (working.length === 0) {
    return FALLBACK_AVG_WORKDAY_MINUTES
  }

  const total = working.reduce((sum, day) => {
    if (!day.startTime || !day.endTime) {
      return sum
    }
    return sum + workdayMinutesFromTimes(day.startTime, day.endTime, day.breakMinutes)
  }, 0)

  return Math.round(total / working.length)
}

export function daysToMinutes(days: number, avgMinutesPerWorkday: number): number {
  return Math.round(days * avgMinutesPerWorkday)
}

/** Leave minutes as working days (one decimal), or null when the average workday is unknown. */
export function approxLeaveDays(minutes: number, avgMinutesPerWorkday: number): number | null {
  if (avgMinutesPerWorkday <= 0) {
    return null
  }

  return Math.round((minutes / avgMinutesPerWorkday) * 10) / 10
}
