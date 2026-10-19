import type { Prisma } from '@prisma/client';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.spec.fixtures.js';
import {
  filterMatcherDateBoundary,
  unsupportedEstimateVersionWhereClause,
} from './workshop-estimate-version-site-list.read.spec.matcher.errors.js';

export function matchEstimateVersionValidUntil(
  row: EstimateVersionFixture,
  validUntil:
    Prisma.DateTimeNullableFilter<'WorkshopEstimateVersion'> | Date | null,
): boolean {
  if (validUntil === null) {
    return row.valid_until === null;
  }
  if (validUntil instanceof Date) {
    return (
      row.valid_until !== null &&
      row.valid_until.getTime() === validUntil.getTime()
    );
  }
  if (validUntil.gte !== undefined) {
    const gte = filterMatcherDateBoundary(validUntil.gte);
    return (
      row.valid_until !== null && row.valid_until.getTime() >= gte.getTime()
    );
  }
  if (validUntil.lt !== undefined) {
    const lt = filterMatcherDateBoundary(validUntil.lt);
    return row.valid_until !== null && row.valid_until.getTime() < lt.getTime();
  }
  unsupportedEstimateVersionWhereClause({ valid_until: validUntil });
}
