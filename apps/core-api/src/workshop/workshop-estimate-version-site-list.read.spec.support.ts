import { Prisma } from '@prisma/client';
import type { EstimateScope } from './workshop-estimate-scope.js';
import {
  compareEstimateVersionsDesc,
  type EstimateVersionFixture,
} from './workshop-estimate-version-site-list.read.spec.fixtures.js';
import { rowMatchesSiteEstimateVersionWhere } from './workshop-estimate-version-site-list.read.spec.matcher.js';

export type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.spec.fixtures.js';

export function createEstimateVersionListPrisma(
  rows: EstimateVersionFixture[],
  scope: EstimateScope,
  now: Date,
) {
  return {
    workshopEstimateVersion: {
      findMany: async ({
        where,
        take,
      }: {
        where: Prisma.WorkshopEstimateVersionWhereInput;
        take: number;
      }) => {
        const matched = rows
          .filter((row) => rowMatchesSiteEstimateVersionWhere(row, where, scope, now))
          .sort(compareEstimateVersionsDesc);
        return matched.slice(0, take);
      },
    },
  };
}
