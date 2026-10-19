import type { Prisma } from '@prisma/client';
import type { EstimateScope } from './workshop-estimate-scope.js';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.fixtures.spec.support.js';
import { unsupportedEstimateVersionWhereClause } from './workshop-estimate-version-site-list.read.matcher-errors.spec.support.js';
import { matchEstimateVersionEstimateScope } from './workshop-estimate-version-site-list.read.matcher-estimate.spec.support.js';
import { matchEstimateVersionIdFilter } from './workshop-estimate-version-site-list.read.matcher-id.spec.support.js';
import { matchEstimateVersionSentAt } from './workshop-estimate-version-site-list.read.matcher-sent-at.spec.support.js';
import { matchEstimateVersionValidUntil } from './workshop-estimate-version-site-list.read.matcher-valid-until.spec.support.js';

type ClauseFieldKey =
  'tenant_id' | 'estimate' | 'sent_at' | 'valid_until' | 'status' | 'id';

type ClauseFieldMatcher = (
  row: EstimateVersionFixture,
  clause: Prisma.WorkshopEstimateVersionWhereInput,
) => boolean;

const CLAUSE_FIELD_MATCHERS: Record<ClauseFieldKey, ClauseFieldMatcher> = {
  tenant_id: () => true,
  estimate: (row, clause) =>
    matchEstimateVersionEstimateScope(row, clause.estimate!),
  sent_at: (row, clause) => {
    const sentAt = clause.sent_at;
    if (
      sentAt === null ||
      sentAt instanceof Date ||
      typeof sentAt === 'object'
    ) {
      return matchEstimateVersionSentAt(row, sentAt);
    }
    unsupportedEstimateVersionWhereClause({ sent_at: sentAt });
  },
  valid_until: (row, clause) => {
    const validUntil = clause.valid_until;
    if (
      validUntil === null ||
      validUntil instanceof Date ||
      typeof validUntil === 'object'
    ) {
      return matchEstimateVersionValidUntil(row, validUntil);
    }
    unsupportedEstimateVersionWhereClause({ valid_until: validUntil });
  },
  status: (row, clause) => row.status === clause.status,
  id: (row, clause) => matchEstimateVersionIdFilter(row, clause.id!),
};

function isClauseFieldKey(key: string): key is ClauseFieldKey {
  return key in CLAUSE_FIELD_MATCHERS;
}

export function matchEstimateVersionWhereClause(
  row: EstimateVersionFixture,
  clause: Prisma.WorkshopEstimateVersionWhereInput,
  _scope: EstimateScope,
  _now: Date,
): boolean {
  if (clause.AND) {
    unsupportedEstimateVersionWhereClause({ AND: clause.AND });
  }

  const { OR: orBranches, ...scalarParts } = clause;
  const keys = Object.keys(scalarParts).filter(
    (key) =>
      scalarParts[key as keyof Prisma.WorkshopEstimateVersionWhereInput] !==
      undefined,
  );
  if (keys.length === 0 && !orBranches) {
    unsupportedEstimateVersionWhereClause(clause);
  }

  for (const key of keys) {
    if (!isClauseFieldKey(key)) {
      unsupportedEstimateVersionWhereClause(clause);
    }
    if (!CLAUSE_FIELD_MATCHERS[key](row, scalarParts)) {
      return false;
    }
  }

  if (orBranches) {
    return orBranches.some((part) =>
      matchEstimateVersionWhereClause(row, part, _scope, _now),
    );
  }
  return true;
}

export function estimateVersionAndClauses(
  where: Prisma.WorkshopEstimateVersionWhereInput,
): Prisma.WorkshopEstimateVersionWhereInput[] {
  if (!where.AND) {
    return [where];
  }
  return Array.isArray(where.AND) ? where.AND : [where.AND];
}
