export function laborNetCents(
  durationMinutes: number,
  unitPriceCents: number,
): number {
  return Math.round((durationMinutes * unitPriceCents) / 60);
}

export function partNetCents(
  quantityMilli: number,
  unitPriceCents: number,
): number {
  return Math.round((quantityMilli * unitPriceCents) / 1000);
}

export function formatQuantityString(value: number): string {
  return value.toFixed(3);
}

export function hoursToDurationMinutes(hours: number): number {
  return Math.round(hours * 60);
}
