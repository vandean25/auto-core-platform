import type { Prisma } from '@prisma/client';

export function unsupportedEstimateVersionWhereClause(
  clause: Prisma.WorkshopEstimateVersionWhereInput,
): never {
  throw new Error(
    `Unsupported estimate-version where clause for in-memory matcher: ${JSON.stringify(clause)}`,
  );
}

export function filterMatcherDateBoundary(
  value: string | Date | Prisma.FieldRef<'WorkshopEstimateVersion', 'DateTime'>,
): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  throw new Error(
    'Unsupported Prisma FieldRef in estimate-version in-memory matcher',
  );
}
