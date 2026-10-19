import type { Prisma } from '@prisma/client';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.fixtures.spec.support.js';
import {
  filterMatcherDateBoundary,
  unsupportedEstimateVersionWhereClause,
} from './workshop-estimate-version-site-list.read.matcher-errors.spec.support.js';

export function matchEstimateVersionSentAt(
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
    const gte = filterMatcherDateBoundary(sentAt.gte);
    if (!row.sent_at || row.sent_at.getTime() < gte.getTime()) {
      return false;
    }
  }
  if (sentAt.lt !== undefined) {
    const lt = filterMatcherDateBoundary(sentAt.lt);
    if (!row.sent_at || row.sent_at.getTime() >= lt.getTime()) {
      return false;
    }
  }
  if (sentAt.gte === undefined && sentAt.lt === undefined) {
    unsupportedEstimateVersionWhereClause({ sent_at: sentAt });
  }
  return true;
}
