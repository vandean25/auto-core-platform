export type CapacityCellHours = {
  capacityHours: number
  bookedHours: number
  freeHours: number
  isOverbooked: boolean
}

const hoursFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function formatHours(value: number): string {
  return `${hoursFormatter.format(value)} h`
}

export function describeCellHours(cell: CapacityCellHours): string {
  if (cell.capacityHours === 0 && cell.bookedHours === 0) {
    return 'Closed'
  }
  if (cell.isOverbooked) {
    const overBy = Math.round((cell.bookedHours - cell.capacityHours) * 100) / 100
    return `Overbooked by ${formatHours(overBy)}`
  }
  if (cell.freeHours === 0) {
    return 'Fully booked'
  }
  return `${formatHours(cell.freeHours)} free`
}

export function formatChipTime(isoInstant: string | null | undefined, timeZone: string): string | null {
  if (!isoInstant) {
    return null
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(isoInstant))
}
