import type { Prisma } from '@prisma/client';
import type { EstimateScope } from './workshop-estimate-scope.js';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.fixtures.spec.support.js';
import {
  estimateVersionAndClauses,
  matchEstimateVersionWhereClause,
} from './workshop-estimate-version-site-list.read.matcher-dispatch.spec.support.js';

export function rowMatchesSiteEstimateVersionWhere(
  row: EstimateVersionFixture,
  where: Prisma.WorkshopEstimateVersionWhereInput,
  scope: EstimateScope,
  now: Date,
): boolean {
  if (row.estimate.site_id !== scope.siteId) {
    return false;
  }
  return estimateVersionAndClauses(where).every((clause) =>
    matchEstimateVersionWhereClause(row, clause, scope, now),
  );
}
