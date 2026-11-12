// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildPlannerCreatePrefill, clampEndToDayWindow, defaultCreateEndTime } from './planner-create-prefill'

const openings = [
  { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
]

describe('planner-create-prefill', () => {
  it('defaults create end to one hour after start', () => {
    const start = new Date('2026-08-21T08:00:00.000Z')
    const end = defaultCreateEndTime(start)
    expect(end.toISOString()).toBe('2026-08-21T09:00:00.000Z')
  })

  it('clamps end to business close', () => {
    const hours = { isClosed: false, openTime: '07:30', closeTime: '17:00' }
    const end = new Date('2026-08-21T20:00:00.000Z')
    const clamped = clampEndToDayWindow(end, hours, 'Europe/Vienna', '2026-08-21')
    expect(clamped.getTime()).toBeLessThan(end.getTime())
  })

  it('builds prefill for a day slot click', () => {
    const prefill = buildPlannerCreatePrefill({
      bayId: 'bay-1',
      startIso: '2026-08-21T08:00:00.000Z',
      openings,
      holidays: [],
      timezone: 'Europe/Vienna',
    })
    expect(prefill.bayId).toBe('bay-1')
    expect(prefill.scheduledStartAt).toBe('2026-08-21T08:00:00.000Z')
    expect(prefill.scheduledEndAt).toBe('2026-08-21T09:00:00.000Z')
  })

  it('builds prefill for a week slot with explicit end', () => {
    const prefill = buildPlannerCreatePrefill({
      bayId: 'bay-1',
      startIso: '2026-08-21T08:00:00.000Z',
      endIso: '2026-08-21T10:00:00.000Z',
      openings,
      holidays: [],
      timezone: 'Europe/Vienna',
    })
    expect(prefill.scheduledEndAt).toBe('2026-08-21T10:00:00.000Z')
  })
})
