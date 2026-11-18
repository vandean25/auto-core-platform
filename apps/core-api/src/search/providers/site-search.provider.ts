import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  collectMatches,
  tierFilter,
  type MatchTier,
  type ScoredRow,
} from '../search-ranking.js';
import type {
  ParsedSearchQuery,
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { joinParts } from './search-format.js';

const TEXT_KINDS = new Set(['number', 'plate', 'name']);
const SELECT = {
  id: true,
  name: true,
  code: true,
  address_city: true,
} as const;
const ORDER_BY: Prisma.SiteOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];

type SiteRow = {
  id: string;
  name: string;
  code: string;
  address_city: string | null;
};

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.SiteWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  if (!TEXT_KINDS.has(query.kind)) return null;
  const nameFilter =
    tier === 'contains'
      ? { AND: query.terms.map((term) => ({ name: tierFilter(tier, term) })) }
      : { name: tierFilter(tier, query.text) };
  return {
    OR: [nameFilter, { code: tierFilter(tier, query.text) }],
  };
}

function toResult({ row, score }: ScoredRow<SiteRow>): SearchResult {
  return {
    type: 'site',
    id: row.id,
    title: row.name,
    subtitle: joinParts([row.code, row.address_city]),
    href: '/settings?tab=sites',
    score,
  };
}

export class SiteSearchProvider implements SearchProvider {
  readonly type = 'site';
  readonly allowedRoles = ['OWNER', 'ADMIN'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectMatches<SiteRow, Prisma.SiteWhereInput>(
      ctx,
      (tier) => matchWhere(ctx.query, tier),
      (match) =>
        this.prisma.site.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
