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

const TEXT_KINDS = new Set(['number', 'plate', 'name']);
const SELECT = { id: true, code: true, description: true } as const;
const ORDER_BY: Prisma.LaborOperationOrderByWithRelationInput[] = [
  { code: 'asc' },
  { id: 'asc' },
];

type LaborOperationRow = {
  id: string;
  code: string;
  description: string;
};

function descriptionWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.LaborOperationWhereInput {
  return tier === 'contains'
    ? {
        AND: query.terms.map((term) => ({
          description: tierFilter(tier, term),
        })),
      }
    : { description: tierFilter(tier, query.text) };
}

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.LaborOperationWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  if (!TEXT_KINDS.has(query.kind)) return null;
  return {
    OR: [{ code: tierFilter(tier, query.text) }, descriptionWhere(query, tier)],
  };
}

function toResult({ row, score }: ScoredRow<LaborOperationRow>): SearchResult {
  return {
    type: 'labor_operation',
    id: row.id,
    title: row.description,
    subtitle: row.code,
    href: '/settings?tab=labor',
    score,
  };
}

/** Master-data labor operations are tenant-wide (no workshopOrderId required). */
export class LaborOperationSearchProvider implements SearchProvider {
  readonly type = 'labor_operation';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectMatches<
      LaborOperationRow,
      Prisma.LaborOperationWhereInput
    >(
      ctx,
      (tier) => matchWhere(ctx.query, tier),
      (match) =>
        this.prisma.laborOperation.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
