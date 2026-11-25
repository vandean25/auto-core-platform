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

const SELECT = {
  id: true,
  user: { select: { email: true, firstName: true, lastName: true } },
} as const;
const ORDER_BY: Prisma.TenantMemberOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

type UserMemberRow = {
  id: string;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

function nameWhere(tier: MatchTier, terms: string[]): Prisma.UserWhereInput {
  return {
    AND: terms.map((term) => ({
      OR: [
        { email: tierFilter(tier, term) },
        { firstName: tierFilter(tier, term) },
        { lastName: tierFilter(tier, term) },
      ],
    })),
  };
}

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.TenantMemberWhereInput | null {
  if (query.kind === 'uuid') {
    const id = query.text.toLowerCase();
    return { OR: [{ id }, { user_id: id }] };
  }
  if (query.kind === 'email') {
    return tier === 'contains'
      ? null
      : { user: { email: tierFilter(tier, query.text) } };
  }
  if (query.kind !== 'name' && query.kind !== 'plate') return null;
  return { user: nameWhere(tier, query.terms) };
}

function toResult({ row, score }: ScoredRow<UserMemberRow>): SearchResult {
  const fullName = [row.user.firstName, row.user.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return {
    type: 'user',
    id: row.id,
    title: fullName || row.user.email,
    subtitle: fullName ? joinParts([row.user.email]) : null,
    href: '/settings/team',
    score,
  };
}

export class UserSearchProvider implements SearchProvider {
  readonly type = 'user';
  readonly allowedRoles = ['OWNER', 'ADMIN'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectMatches<
      UserMemberRow,
      Prisma.TenantMemberWhereInput
    >(
      ctx,
      (tier) => matchWhere(ctx.query, tier),
      (match) =>
        this.prisma.tenantMember.findMany({
          where: { ...match, tenant_id: ctx.tenantId, is_active: true },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
