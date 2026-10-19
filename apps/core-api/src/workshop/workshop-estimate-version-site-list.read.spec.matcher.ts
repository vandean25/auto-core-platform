import { Prisma } from '@prisma/client';
import type { EstimateScope } from './workshop-estimate-scope.js';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.spec.fixtures.js';

function unsupportedClause(
  clause: Prisma.WorkshopEstimateVersionWhereInput,
): never {
  throw new Error(
    `Unsupported estimate-version where clause for in-memory matcher: ${JSON.stringify(clause)}`,
  );
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function matchesIdFilter(
  row: EstimateVersionFixture,
  filter: Prisma.StringFilter<'WorkshopEstimateVersion'> | string,
): boolean {
  if (typeof filter === 'string') {
    return row.id === filter;
  }
  if (filter.lt !== undefined) {
    return row.id < filter.lt;
  }
  unsupportedClause({ id: filter });
}

function matchesValidUntil(
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
    const gte = toDate(validUntil.gte);
    return (
      row.valid_until !== null && row.valid_until.getTime() >= gte.getTime()
    );
  }
  if (validUntil.lt !== undefined) {
    const lt = toDate(validUntil.lt);
    return row.valid_until !== null && row.valid_until.getTime() < lt.getTime();
  }
  unsupportedClause({ valid_until: validUntil });
}

function matchesSentAt(
  row: EstimateVersionFixture,
  sentAt:
    Prisma.DateTimeNullableFilter<'WorkshopEstimateVersion'> | Date | null,
): boolean {
  if (sentAt === null) {
    return row.sent_at === null;
  }
  if (sentAt instanceof Date) {
    return row.sent_at !== null && row.sent_at.getTime() === sentAt.getTime();
  }
  if (sentAt.gte !== undefined) {
    const gte = toDate(sentAt.gte);
    if (!row.sent_at || row.sent_at.getTime() < gte.getTime()) {
      return false;
    }
  }
  if (sentAt.lt !== undefined) {
    const lt = toDate(sentAt.lt);
    if (!row.sent_at || row.sent_at.getTime() >= lt.getTime()) {
      return false;
    }
  }
  if (sentAt.gte === undefined && sentAt.lt === undefined) {
    unsupportedClause({ sent_at: sentAt });
  }
  return true;
}

function matchesEstimate(
  row: EstimateVersionFixture,
  estimate: Prisma.WorkshopEstimateWhereInput,
): boolean {
  if (estimate.site_id && row.estimate.site_id !== estimate.site_id) {
    return false;
  }
  if (
    estimate.workshop_order_id &&
    row.estimate.workshop_order_id !== estimate.workshop_order_id
  ) {
    return false;
  }
  const customerId = estimate.workshop_order?.customer_id;
  if (
    typeof customerId === 'string' &&
    row.estimate.workshop_order.customer_id !== customerId
  ) {
    return false;
  }
  return true;
}

function matchesSingleClause(
  row: EstimateVersionFixture,
  clause: Prisma.WorkshopEstimateVersionWhereInput,
  scope: EstimateScope,
  now: Date,
): boolean {
  if (clause.AND) {
    unsupportedClause({ AND: clause.AND });
  }

  const { OR: orBranches, ...scalarParts } = clause;
  const keys = Object.keys(scalarParts).filter(
    (key) =>
      scalarParts[key as keyof Prisma.WorkshopEstimateVersionWhereInput] !==
      undefined,
  );
  if (keys.length === 0 && !orBranches) {
    unsupportedClause(clause);
  }

  for (const key of keys) {
    switch (key) {
      case 'tenant_id':
        break;
      case 'estimate':
        if (!matchesEstimate(row, scalarParts.estimate!)) {
          return false;
        }
        break;
      case 'sent_at': {
        const sentAt = scalarParts.sent_at;
        if (
          sentAt === null ||
          sentAt instanceof Date ||
          typeof sentAt === 'object'
        ) {
          if (!matchesSentAt(row, sentAt)) {
            return false;
          }
        } else {
          unsupportedClause({ sent_at: sentAt });
        }
        break;
      }
      case 'valid_until': {
        const validUntil = scalarParts.valid_until;
        if (
          validUntil === null ||
          validUntil instanceof Date ||
          typeof validUntil === 'object'
        ) {
          if (!matchesValidUntil(row, validUntil)) {
            return false;
          }
        } else {
          unsupportedClause({ valid_until: validUntil });
        }
        break;
      }
      case 'status':
        if (row.status !== scalarParts.status) {
          return false;
        }
        break;
      case 'id':
        if (!matchesIdFilter(row, scalarParts.id!)) {
          return false;
        }
        break;
      default:
        unsupportedClause(clause);
    }
  }

  if (orBranches) {
    return orBranches.some((part) =>
      matchesSingleClause(row, part, scope, now),
    );
  }
  return true;
}

function andClauses(
  where: Prisma.WorkshopEstimateVersionWhereInput,
): Prisma.WorkshopEstimateVersionWhereInput[] {
  if (!where.AND) {
    return [where];
  }
  return Array.isArray(where.AND) ? where.AND : [where.AND];
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
  return andClauses(where).every((clause) =>
    matchesSingleClause(row, clause, scope, now),
  );
}
