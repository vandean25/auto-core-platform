import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  collectSiteRanked,
  tierFilter,
  tiersFor,
  type MatchTier,
  type ScoredRow,
} from '../search-ranking.js';
import type {
  ParsedSearchQuery,
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { customerMatchWhere } from './customer-match.js';
import { customerLabel, joinParts } from './search-format.js';
import { vehicleMatchWhere } from './vehicle-match.js';

const SELECT = {
  id: true,
  invoice_number: true,
  site_id: true,
  customer: {
    select: { first_name: true, last_name: true, company_name: true },
  },
  vehicle: { select: { plate: true } },
} as const;
const ORDER_BY: Prisma.InvoiceOrderByWithRelationInput[] = [
  { date: 'desc' },
  { id: 'asc' },
];

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  site_id: string | null;
  customer: {
    first_name: string;
    last_name: string;
    company_name: string | null;
  };
  vehicle: { plate: string | null } | null;
};

function matchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.InvoiceWhereInput | null {
  const or: Prisma.InvoiceWhereInput[] = [];
  if (query.kind === 'uuid') or.push({ id: query.text.toLowerCase() });
  if (query.kind === 'number') {
    or.push({ invoice_number: tierFilter(tier, query.text) });
  }
  const vehicle = vehicleMatchWhere(query, tier);
  if (vehicle) or.push({ vehicle });
  const customer = customerMatchWhere(query, tier, false);
  if (customer) or.push({ customer });
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<InvoiceRow>): SearchResult {
  return {
    type: 'invoice',
    id: row.id,
    title: row.invoice_number ?? row.id,
    subtitle: joinParts([customerLabel(row.customer), row.vehicle?.plate]),
    href: `/sales/invoices/${row.id}`,
    score,
    ...(row.site_id ? { siteId: row.site_id } : {}),
  };
}

/** Only issued invoices (those with a number) are searchable; drafts have none. */
export class InvoiceSearchProvider implements SearchProvider {
  readonly type = 'invoice';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;
  readonly siteScoped = true;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectSiteRanked<InvoiceRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.query, tier);
        if (!match) return [];
        return this.prisma.invoice.findMany({
          where: {
            AND: [match, { invoice_number: { not: null } }],
            tenant_id: ctx.tenantId,
            site_id: { in: siteIds },
          },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        });
      },
      tiersFor(ctx.query),
    );
    return rows.map(toResult);
  }
}
