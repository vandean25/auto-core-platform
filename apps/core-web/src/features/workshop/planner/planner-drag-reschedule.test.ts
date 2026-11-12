// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlannerBooking } from '@/api/workshop'
import {
  buildDaySlotReschedule,
  buildWeekSlotReschedule,
  isPlannerDragReschedulable,
  resolvePlannerDragReschedule,
  plannerBookingDurationMs,
  resolveWeekSlotStartIso,
} from './planner-drag-reschedule'

const booking: PlannerBooking = {
  orderId: 'order-1',
  orderNumber: 'WO-1',
  status: 'SCHEDULED',
  occupancyKind: 'BOOKING',
  bayId: 'bay-1',
  mechanicId: null,
  mechanicName: null,
  scheduledStartAt: '2026-08-21T08:00:00.000Z',
  scheduledEndAt: '2026-08-21T09:00:00.000Z',
  customer: { id: 'c1', displayName: 'A' },
  vehicle: { id: 'v1', make: 'VW', model: 'Golf', year: 2020, plate: 'W-1' },
}

const openings = [
  { weekday: 6, isClosed: false, openTime: '07:30', closeTime: '17:00' },
]

describe('planner-drag-reschedule', () => {
  it('measures booking duration', () => {
    expect(plannerBookingDurationMs(booking)).toBe(3_600_000)
  })

  it('allows drag only for scheduled bookings', () => {
    expect(isPlannerDragReschedulable(booking)).toBe(true)
    expect(isPlannerDragReschedulable({ ...booking, status: 'INTAKE' })).toBe(false)
  })

  it('builds day-slot reschedule payload', () => {
    const request = buildDaySlotReschedule(booking, 'bay-2', '2026-08-21T11:00:00.000Z')
    expect(request).toEqual({
      orderId: 'order-1',
      bayId: 'bay-2',
      startIso: '2026-08-21T11:00:00.000Z',
      durationMs: 3_600_000,
    })
  })

  it('preserves wall-clock when moving to another week day', () => {
    const hours = { isClosed: false, openTime: '07:30', closeTime: '17:00' }
    expect(resolveWeekSlotStartIso(booking, '2026-08-22', hours, 'Europe/Vienna')).toBe(
      '2026-08-22T08:00:00.000Z',
    )
  })

  it('resolves drag target ids into reschedule payloads', () => {
    const day = resolvePlannerDragReschedule(
      booking,
      'planner-slot-bay-2__2026-08-21T11:00:00.000Z',
      openings,
      [],
      'Europe/Vienna',
    )
    expect(day?.bayId).toBe('bay-2')

    const week = resolvePlannerDragReschedule(
      booking,
      'planner-week-slot-bay-1__2026-08-22',
      openings,
      [],
      'Europe/Vienna',
    )
    expect(week?.startIso).toBe('2026-08-22T08:00:00.000Z')
  })

  it('builds week-slot reschedule payload', () => {
    const request = buildWeekSlotReschedule(
      booking,
      'bay-1',
      '2026-08-22',
      openings,
      [],
      'Europe/Vienna',
    )
    expect(request.startIso).toBe('2026-08-22T08:00:00.000Z')
    expect(request.durationMs).toBe(3_600_000)
  })
})
