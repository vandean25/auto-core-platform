import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { collectMatches, type ScoredRow } from '../search-ranking.js';
import type {
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { customerMatchWhere } from './customer-match.js';
import { customerLabel, joinParts } from './search-format.js';

const BASE_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  company_name: true,
} as const;
const FULL_SELECT = { ...BASE_SELECT, email: true, phone: true } as const;
const ORDER_BY: Prisma.CustomerOrderByWithRelationInput[] = [
  { last_name: 'asc' },
  { first_name: 'asc' },
  { id: 'asc' },
];

type CustomerRow = {
  id: string;
  first_name: string;
  last_name: string;
  company_name: string | null;
  email?: string | null;
  phone?: string | null;
};

function toResult({ row, score }: ScoredRow<CustomerRow>): SearchResult {
  return {
    type: 'customer',
    id: row.id,
    title: customerLabel(row),
    // TECH rows never select email/phone, so the subtitle stays empty for them.
    subtitle: joinParts([row.email, row.phone]),
    href: `/customers/${row.id}`,
    score,
  };
}

export class CustomerSearchProvider implements SearchProvider {
  readonly type = 'customer';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const restricted = ctx.role === 'TECH';
    const rows = await collectMatches<CustomerRow, Prisma.CustomerWhereInput>(
      ctx,
      (tier) => customerMatchWhere(ctx.query, tier, restricted),
      (match) =>
        this.prisma.customer.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: restricted ? BASE_SELECT : FULL_SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
