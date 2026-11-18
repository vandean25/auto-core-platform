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

const SELECT = {
  id: true,
  credit_number: true,
  site_id: true,
  original_invoice: {
    select: {
      invoice_number: true,
      customer: {
        select: { first_name: true, last_name: true, company_name: true },
      },
    },
  },
} as const;
const ORDER_BY: Prisma.CreditNoteOrderByWithRelationInput[] = [
  { date: 'desc' },
  { id: 'asc' },
];

type CreditNoteRow = {
  id: string;
  credit_number: string | null;
  site_id: string;
  original_invoice: {
    invoice_number: string | null;
    customer: {
      first_name: string;
      last_name: string;
      company_name: string | null;
    };
  };
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.CreditNoteWhereInput | null {
  const or: Prisma.CreditNoteWhereInput[] = [];
  if (query.kind === 'uuid') or.push({ id: query.text.toLowerCase() });
  if (query.kind === 'number') {
    or.push({ credit_number: tierFilter(tier, query.text) });
  }
  const customer = customerMatchWhere(query, tier, false);
  if (customer) {
    or.push({
      original_invoice: {
        tenant_id: tenantId,
        customer: { ...customer, tenant_id: tenantId },
      },
    });
  }
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<CreditNoteRow>): SearchResult {
  return {
    type: 'credit_note',
    id: row.id,
    title: row.credit_number ?? row.id,
    subtitle: joinParts([
      customerLabel(row.original_invoice.customer),
      row.original_invoice.invoice_number,
    ]),
    href: `/finance/credit-notes/${row.id}`,
    score,
    siteId: row.site_id,
  };
}

/** Only finalized credit notes (those with a number) are searchable; drafts have none. */
export class CreditNoteSearchProvider implements SearchProvider {
  readonly type = 'credit_note';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectSiteRanked<CreditNoteRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.tenantId, ctx.query, tier);
        if (!match) return [];
        return this.prisma.creditNote.findMany({
          where: {
            AND: [match, { credit_number: { not: null } }],
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
