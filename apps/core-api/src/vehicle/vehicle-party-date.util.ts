/** `YYYY-MM-DD` day to the UTC date-only value stored in a `@db.Date` column. */
export function dayToDate(day: string | null): Date | null {
  return day === null ? null : new Date(`${day}T00:00:00.000Z`);
}

export function dateToDay(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}
