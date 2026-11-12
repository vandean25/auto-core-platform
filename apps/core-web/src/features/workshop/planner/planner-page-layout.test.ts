// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildPlannerDaySlots,
  buildPlannerPageSubtitle,
  buildPlannerWeekDates,
  computePlannerQueryRange,
  plannerAnchorShiftDays,
  resolvePlannerDayHours,
  shouldShowPlannerClosedDay,
} from './planner-page-layout'

const openings = [
  { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
  { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
]

describe('planner-page-layout', () => {
  it('builds day subtitle from anchor date', () => {
    const subtitle = buildPlannerPageSubtitle('day', '2026-08-21', '2026-08-18', 'Europe/Vienna')
    expect(subtitle).toContain('2026')
  })

  it('builds week subtitle with range', () => {
    const subtitle = buildPlannerPageSubtitle('week', '2026-08-21', '2026-08-18', 'Europe/Vienna')
    expect(subtitle).toContain('–')
  })

  it('computes UTC query range for day view', () => {
    const range = computePlannerQueryRange('day', '2026-08-21', 'Europe/Vienna')
    expect(range.rangeFromDate).toBe('2026-08-21')
    expect(range.from).toMatch(/Z$/)
  })

  it('computes week dates for grid', () => {
    const dates = buildPlannerWeekDates('2026-08-18')
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-08-18')
  })

  it('resolves day hours only in day mode', () => {
    expect(resolvePlannerDayHours('week', '2026-08-21', openings, [])).toBeNull()
    const hours = resolvePlannerDayHours('day', '2026-08-21', openings, [])
    expect(hours?.isClosed).toBe(false)
  })

  it('builds slots for an open day', () => {
    const hours = resolvePlannerDayHours('day', '2026-08-21', openings, [])!
    const slots = buildPlannerDaySlots('day', hours, 60, 'Europe/Vienna', '2026-08-21')
    expect(slots.length).toBeGreaterThan(0)
  })

  it('shows closed-day banner when bays exist', () => {
    const hours = { isClosed: true, openTime: null, closeTime: null }
    expect(shouldShowPlannerClosedDay('day', hours, 2)).toBe(true)
    expect(shouldShowPlannerClosedDay('week', hours, 2)).toBe(false)
  })

  it('shifts anchor by day or week increments', () => {
    expect(plannerAnchorShiftDays('day', -1)).toBe(-1)
    expect(plannerAnchorShiftDays('week', 1)).toBe(7)
  })
})
