import type { Prisma } from '@prisma/client';
import type { EstimateScope } from './workshop-estimate-scope.js';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.spec.fixtures.js';
import {
  estimateVersionAndClauses,
  matchEstimateVersionWhereClause,
} from './workshop-estimate-version-site-list.read.spec.matcher.dispatch.js';

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
