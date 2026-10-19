import type { Prisma } from '@prisma/client';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.fixtures.spec.support.js';
import { unsupportedEstimateVersionWhereClause } from './workshop-estimate-version-site-list.read.matcher-errors.spec.support.js';

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
