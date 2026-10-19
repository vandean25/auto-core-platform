import type { Prisma } from '@prisma/client';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.spec.fixtures.js';
import { unsupportedEstimateVersionWhereClause } from './workshop-estimate-version-site-list.read.spec.matcher.errors.js';

export function matchEstimateVersionIdFilter(
  row: EstimateVersionFixture,
  filter: Prisma.StringFilter<'WorkshopEstimateVersion'> | string,
): boolean {
  if (typeof filter === 'string') {
    return row.id === filter;
  }
  if (filter.lt !== undefined) {
    return row.id < filter.lt;
  }
  unsupportedEstimateVersionWhereClause({ id: filter });
}
