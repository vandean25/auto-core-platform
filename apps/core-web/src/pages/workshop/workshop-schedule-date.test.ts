import { describe, expect, it } from 'vitest'
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/constants'
import { shiftScheduleToLocalDate } from './workshop-schedule-date'

describe('shiftScheduleToLocalDate', () => {
  it('keeps the Vienna wall-clock start and the duration on the chosen day', () => {
    const shifted = shiftScheduleToLocalDate(
      '2026-08-21T06:00:00.000Z',
      '2026-08-21T07:30:00.000Z',
      '2026-08-24',
      DEFAULT_TIME_ZONE,
    )

    expect(shifted).toEqual({
      scheduledStartAt: '2026-08-24T06:00:00.000Z',
      scheduledEndAt: '2026-08-24T07:30:00.000Z',
    })
  })
})
