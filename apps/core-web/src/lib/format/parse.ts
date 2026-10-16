export function parseIsoDateOnly(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) {
    return null
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function parseFiniteNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') {
    return null
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
