import type { Prisma } from '@prisma/client';
import type { ParsedSearchQuery, SiteScope } from './search.types.js';

/** exact > prefix > contains; every tier is an ILIKE the trigram indexes (AUT-661) can serve. */
export type MatchTier = 'exact' | 'prefix' | 'contains';

export const MATCH_TIERS: readonly MatchTier[] = [
  'exact',
  'prefix',
  'contains',
];

export const TIER_SCORE: Record<MatchTier, number> = {
  exact: 1,
  prefix: 0.8,
  contains: 0.5,
};

/** A uuid is an id lookup, so only the exact tier can match. */
export function tiersFor(query: ParsedSearchQuery): readonly MatchTier[] {
  return query.kind === 'uuid' ? ['exact'] : MATCH_TIERS;
}

export interface ScoredRow<T> {
  row: T;
  score: number;
}

/** Prisma binds the value into ILIKE as is, so `%` and `_` typed by a user would act as wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function tierFilter(tier: MatchTier, raw: string): Prisma.StringFilter {
  const value = escapeLike(raw);
  switch (tier) {
    case 'exact':
      return { equals: value, mode: 'insensitive' };
    case 'prefix':
      return { startsWith: value, mode: 'insensitive' };
    default:
      return { contains: value, mode: 'insensitive' };
  }
}

/**
 * Runs one query per tier in parallel and merges them best tier first. Each query must
 * `take` the limit in the database and end its `orderBy` with `id`, so the window is deterministic.
 */
export async function collectRanked<T extends { id: string }>(
  limit: number,
  fetch: (tier: MatchTier) => Promise<T[]>,
  tiers: readonly MatchTier[] = MATCH_TIERS,
): Promise<ScoredRow<T>[]> {
  const perTier = await Promise.all(tiers.map((tier) => fetch(tier)));
  const seen = new Set<string>();
  const merged: ScoredRow<T>[] = [];
  for (const [index, rows] of perTier.entries()) {
    for (const row of rows) {
      if (merged.length >= limit) return merged;
      if (!seen.has(row.id)) {
        seen.add(row.id);
        merged.push({ row, score: TIER_SCORE[tiers[index]] });
      }
    }
  }
  return merged;
}

/**
 * One tiered search: `buildWhere` returns the predicate for a tier (or null when the input says nothing about
 * this entity, which skips the query) and `find` runs it with `take: limit`.
 */
export function collectMatches<T extends { id: string }, W>(
  ctx: { query: ParsedSearchQuery; limit: number },
  buildWhere: (tier: MatchTier) => W | null,
  find: (where: W) => Promise<T[]>,
): Promise<ScoredRow<T>[]> {
  return collectRanked(
    ctx.limit,
    async (tier) => {
      const where = buildWhere(tier);
      return where ? find(where) : [];
    },
    tiersFor(ctx.query),
  );
}

/** Active-site hits first, then hits of the other authorized sites of the same tenant. */
export async function collectSiteRanked<T extends { id: string }>(
  limit: number,
  scope: SiteScope,
  fetch: (tier: MatchTier, siteIds: string[]) => Promise<T[]>,
  tiers?: readonly MatchTier[],
): Promise<ScoredRow<T>[]> {
  const active = scope.siteIds.filter((id) => id === scope.activeSiteId);
  const others = scope.siteIds.filter((id) => id !== scope.activeSiteId);
  const groups = [active, others].filter((siteIds) => siteIds.length > 0);
  const perGroup = await Promise.all(
    groups.map((siteIds) =>
      collectRanked(limit, (tier) => fetch(tier, siteIds), tiers),
    ),
  );
  return perGroup.flat().slice(0, limit);
}
