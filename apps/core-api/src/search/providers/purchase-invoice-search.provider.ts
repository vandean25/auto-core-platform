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
  invoice_number: true,
  vendor_invoice_number: true,
  vendor: { select: { name: true } },
} as const;
const ORDER_BY: Prisma.PurchaseInvoiceOrderByWithRelationInput[] = [
  { invoice_date: 'desc' },
  { id: 'asc' },
];

type PurchaseInvoiceRow = {
  id: string;
  invoice_number: string | null;
  vendor_invoice_number: string;
  vendor: { name: string };
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.PurchaseInvoiceWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  const or: Prisma.PurchaseInvoiceWhereInput[] = [];
  if (
    query.kind === 'number' ||
    query.kind === 'plate' ||
    query.kind === 'name'
  ) {
    or.push(
      { invoice_number: tierFilter(tier, query.text) },
      { vendor_invoice_number: tierFilter(tier, query.text) },
    );
  }
  if (query.kind === 'name' || query.kind === 'plate') {
    or.push({
      vendor: { tenant_id: tenantId, name: tierFilter(tier, query.text) },
    });
  }
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<PurchaseInvoiceRow>): SearchResult {
  return {
    type: 'purchase_invoice',
    id: row.id,
    title: row.invoice_number ?? row.vendor_invoice_number,
    subtitle: joinParts([
      row.vendor.name,
      row.invoice_number ? row.vendor_invoice_number : null,
    ]),
    href: `/purchase-bills/${row.id}`,
    score,
  };
}

/** Purchase invoices have no site_id on the schema, so results are tenant-wide. */
export class PurchaseInvoiceSearchProvider implements SearchProvider {
  readonly type = 'purchase_invoice';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const rows = await collectMatches<
      PurchaseInvoiceRow,
      Prisma.PurchaseInvoiceWhereInput
    >(
      ctx,
      (tier) => matchWhere(ctx.tenantId, ctx.query, tier),
      (match) =>
        this.prisma.purchaseInvoice.findMany({
          where: { ...match, tenant_id: ctx.tenantId },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        }),
    );
    return rows.map(toResult);
  }
}
