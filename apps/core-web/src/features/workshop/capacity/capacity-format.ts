import { formatHours as formatHoursValue, formatTimeInZone } from '@/lib/format'
import { i18n } from '@/lib/i18n'

export type CapacityCellHours = {
  capacityHours: number
  bookedHours: number
  freeHours: number
  isOverbooked: boolean
}

export function formatHours(value: number): string {
  return formatHoursValue(value)
}

export function describeCellHours(cell: CapacityCellHours): string {
  if (cell.capacityHours === 0 && cell.bookedHours === 0) {
    return i18n.t('capacity.cell.closed', { ns: 'workshop' })
  }
  if (cell.isOverbooked) {
    const overBy = Math.round((cell.bookedHours - cell.capacityHours) * 100) / 100
    return i18n.t('capacity.cell.overbooked', { ns: 'workshop', hours: formatHours(overBy) })
  }
  if (cell.freeHours === 0) {
    return i18n.t('capacity.cell.fullyBooked', { ns: 'workshop' })
  }
  return i18n.t('capacity.cell.free', { ns: 'workshop', hours: formatHours(cell.freeHours) })
}

export function formatChipTime(isoInstant: string | null | undefined, timeZone: string): string | null {
  return formatTimeInZone(isoInstant, timeZone)
}
