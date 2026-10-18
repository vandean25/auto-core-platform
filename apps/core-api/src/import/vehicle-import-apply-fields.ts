export function toImportFirstRegistrationDate(
  value: unknown,
): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`);
}
