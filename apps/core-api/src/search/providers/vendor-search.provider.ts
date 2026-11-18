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
  email: true,
  account_number: true,
} as const;
const ORDER_BY: Prisma.VendorOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];

type VendorRow = {
  id: string;
  name: string;
  email: string;
  account_number: string;
};

function nameWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.VendorWhereInput {
  return tier === 'contains'
    ? { AND: query.terms.map((term) => ({ name: tierFilter(tier, term) })) }
    : { name: tierFilter(tier, query.text) };
}

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.VendorWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  if (query.kind === 'email') {
    return tier === 'contains' ? null : { email: tierFilter(tier, query.text) };
  }
  if (!TEXT_KINDS.has(query.kind)) return null;
  const or: Prisma.VendorWhereInput[] = [
    nameWhere(query, tier),
    { account_number: tierFilter(tier, query.text) },
  ];
  if (tier !== 'contains') {
    or.push({ email: tierFilter(tier, query.text) });
  }
  return { OR: or };
}

function toResult({ row, score }: ScoredRow<VendorRow>): SearchResult {
  return {
    type: 'vendor',
    id: row.id,
    title: row.name,
    subtitle: joinParts([row.account_number, row.email]),
    href: `/vendors/${row.id}`,
    score,
  };
}

export class VendorSearchProvider implements SearchProvider {
  readonly type = 'vendor';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectMatches<VendorRow, Prisma.VendorWhereInput>(
      ctx,
      (tier) => matchWhere(ctx.query, tier),
      (match) =>
        this.prisma.vendor.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
