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
  tax_number: true,
  registration_number: true,
} as const;
const ORDER_BY: Prisma.LegalEntityOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];

type LegalEntityRow = {
  id: string;
  name: string;
  tax_number: string | null;
  registration_number: string | null;
};

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.LegalEntityWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  if (!TEXT_KINDS.has(query.kind)) return null;
  const nameFilter =
    tier === 'contains'
      ? { AND: query.terms.map((term) => ({ name: tierFilter(tier, term) })) }
      : { name: tierFilter(tier, query.text) };
  return {
    OR: [
      nameFilter,
      { tax_number: tierFilter(tier, query.text) },
      { registration_number: tierFilter(tier, query.text) },
    ],
  };
}

function toResult({ row, score }: ScoredRow<LegalEntityRow>): SearchResult {
  return {
    type: 'legal_entity',
    id: row.id,
    title: row.name,
    subtitle: joinParts([row.tax_number, row.registration_number]),
    href: '/settings?tab=legal-entities',
    score,
  };
}

export class LegalEntitySearchProvider implements SearchProvider {
  readonly type = 'legal_entity';
  readonly allowedRoles = ['OWNER', 'ADMIN'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectMatches<
      LegalEntityRow,
      Prisma.LegalEntityWhereInput
    >(
      ctx,
      (tier) => matchWhere(ctx.query, tier),
      (match) =>
        this.prisma.legalEntity.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
