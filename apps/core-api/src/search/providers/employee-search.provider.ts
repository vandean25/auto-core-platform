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

const SELECT = {
  id: true,
  name: true,
  user: { select: { email: true } },
} as const;
const ORDER_BY: Prisma.EmployeeOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];

type EmployeeRow = {
  id: string;
  name: string;
  user: { email: string } | null;
};

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.EmployeeWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  if (query.kind !== 'name' && query.kind !== 'plate') return null;
  return tier === 'contains'
    ? { AND: query.terms.map((term) => ({ name: tierFilter(tier, term) })) }
    : { name: tierFilter(tier, query.text) };
}

function toResult({ row, score }: ScoredRow<EmployeeRow>): SearchResult {
  return {
    type: 'employee',
    id: row.id,
    title: row.name,
    subtitle: row.user?.email ?? null,
    href: '/hr/employees',
    score,
  };
}

export class EmployeeSearchProvider implements SearchProvider {
  readonly type = 'employee';
  readonly allowedRoles = ['OWNER', 'ADMIN'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectMatches<EmployeeRow, Prisma.EmployeeWhereInput>(
      ctx,
      (tier) => matchWhere(ctx.query, tier),
      (match) =>
        this.prisma.employee.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
