import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import type { EstimateScope } from './workshop-estimate-scope.js';

export type EstimateVersionFixture = {
  id: string;
  version: number;
  status: WorkshopEstimateStatus;
  sent_at: Date | null;
  valid_until: Date | null;
  total_net: null;
  total_gross: null;
  approvals: [];
  estimate: {
    estimate_number: string;
    workshop_order_id: string;
    site_id: string;
    workshop_order: {
      customer_id: string | null;
      order_number: string;
    };
  };
};

function compareRowsDesc(left: EstimateVersionFixture, right: EstimateVersionFixture) {
  if (left.sent_at === null && right.sent_at !== null) {
    return 1;
  }
  if (right.sent_at === null && left.sent_at !== null) {
    return -1;
  }
  const leftMs = left.sent_at?.getTime() ?? 0;
  const rightMs = right.sent_at?.getTime() ?? 0;
  if (leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  return right.id.localeCompare(left.id);
}

function matchesSingleClause(
  row: EstimateVersionFixture,
  clause: Prisma.WorkshopEstimateVersionWhereInput,
  scope: EstimateScope,
  now: Date,
): boolean {
  if (clause.estimate?.site_id && row.estimate.site_id !== clause.estimate.site_id) {
    return false;
  }
  if (clause.sent_at?.gte) {
    if (!row.sent_at || row.sent_at.getTime() < clause.sent_at.gte.getTime()) {
      return false;
    }
  }
  if (clause.sent_at?.lt && !('gt' in clause.sent_at)) {
    if (!row.sent_at || row.sent_at.getTime() >= clause.sent_at.lt.getTime()) {
      return false;
    }
  }
  if (clause.valid_until === null) {
    return row.valid_until === null;
  }
  if (clause.valid_until?.gte) {
    return (
      row.valid_until !== null &&
      row.valid_until.getTime() >= clause.valid_until.gte.getTime()
    );
  }
  if (clause.valid_until?.lt) {
    return (
      row.valid_until !== null &&
      row.valid_until.getTime() < clause.valid_until.lt.getTime()
    );
  }
  if (clause.status && !clause.OR) {
    return row.status === clause.status;
  }
  if (clause.status && clause.OR) {
    if (row.status !== clause.status) {
      return false;
    }
    return clause.OR.some((part) =>
      matchesSingleClause(
        row,
        part,
        scope,
        now,
      ),
    );
  }
  if (clause.OR) {
    return clause.OR.some((part) =>
      matchesSingleClause(
        row,
        part,
        scope,
        now,
      ),
    );
  }
  if (clause.sent_at && typeof clause.sent_at === 'object' && 'lt' in clause.sent_at) {
    const lt = clause.sent_at.lt as Date;
    return row.sent_at !== null && row.sent_at.getTime() < lt.getTime();
  }
  if (clause.id?.lt && clause.sent_at instanceof Date) {
    return (
      row.sent_at !== null &&
      row.sent_at.getTime() === clause.sent_at.getTime() &&
      row.id < clause.id.lt
    );
  }
  if (clause.sent_at === null && clause.id?.lt) {
    return row.sent_at === null && row.id < clause.id.lt;
  }
  return true;
}

export function rowMatchesSiteEstimateVersionWhere(
  row: EstimateVersionFixture,
  where: Prisma.WorkshopEstimateVersionWhereInput,
  scope: EstimateScope,
  now: Date,
): boolean {
  if (row.estimate.site_id !== scope.siteId) {
    return false;
  }
  const clauses = where.AND ?? [where];
  return clauses.every((clause) => matchesSingleClause(row, clause, scope, now));
}

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
          .sort(compareRowsDesc);
        return matched.slice(0, take);
      },
    },
  };
}
