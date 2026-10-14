// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describeCellHours, formatChipTime, formatHours } from './capacity-format'

describe('capacity-format', () => {
  it('formats hours with at most two decimals', () => {
    expect(formatHours(2.5)).toBe('2.5 h')
    expect(formatHours(3)).toBe('3 h')
    expect(formatHours(1.13)).toBe('1.13 h')
  })

  it('describes the free-hours state of a cell', () => {
    expect(
      describeCellHours({ capacityHours: 9.5, bookedHours: 6.5, freeHours: 3, isOverbooked: false }),
    ).toBe('3 h free')
    expect(
      describeCellHours({ capacityHours: 9.5, bookedHours: 9.5, freeHours: 0, isOverbooked: false }),
    ).toBe('Fully booked')
    expect(
      describeCellHours({ capacityHours: 9.5, bookedHours: 10, freeHours: 0, isOverbooked: true }),
    ).toBe('Overbooked by 0.5 h')
    expect(
      describeCellHours({ capacityHours: 0, bookedHours: 0, freeHours: 0, isOverbooked: false }),
    ).toBe('Closed')
  })

  it('shows a planned start in the site timezone and nothing for unscheduled work', () => {
    expect(formatChipTime('2026-10-12T06:00:00.000Z', 'Europe/Vienna')).toBe('08:00')
    expect(formatChipTime(null, 'Europe/Vienna')).toBeNull()
  })
})
