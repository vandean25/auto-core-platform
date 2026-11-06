import { InvoiceStatus, type Prisma } from '@prisma/client';
import {
  GLOBAL_LIST_LIMIT_MAX,
  LIST_CURSOR_ENDPOINT,
  listCursorSortUnsupportedException,
  type KeysetSortDirection,
} from '../common/list-cursor/index.js';

export const INVOICE_CURSOR_ENDPOINT = LIST_CURSOR_ENDPOINT.invoices;

/** Page size when the client sends no `limit`; the ceiling is the global list ceiling. */
const INVOICE_CURSOR_DEFAULT_LIMIT = 25;

/**
 * Cursor-capable invoice sorts. Customer name (relation), status and total are not approved for keyset paging and
 * stay on the unpaged list (ADR-0035 §3).
 */
export type InvoiceCursorSortField = 'invoice_number' | 'date';

const INVOICE_CURSOR_SORTS: Record<
  InvoiceCursorSortField,
  { prismaField: string; valueKind: 'string' | 'date'; nullable: boolean }
> = {
  // Drafts have no number yet: NULLS LAST in both directions, ties broken by the unique id.
  invoice_number: {
    prismaField: 'invoice_number',
    valueKind: 'string',
    nullable: true,
  },
  date: { prismaField: 'date', valueKind: 'date', nullable: false },
};

export type InvoiceListQuery = {
  search?: string;
  sortField?: string;
  sortDirection?: KeysetSortDirection;
  limit?: string;
  cursor?: string;
};

/** Newest first, as the list page showed invoices before. */
export function resolveInvoiceCursorSort(
  sortField?: string,
  sortDirection?: KeysetSortDirection,
) {
  const field = sortField ?? 'date';
  if (!Object.hasOwn(INVOICE_CURSOR_SORTS, field)) {
    throw listCursorSortUnsupportedException();
  }
  return {
    field: field as InvoiceCursorSortField,
    direction: sortDirection ?? (sortField ? 'asc' : 'desc'),
    config: INVOICE_CURSOR_SORTS[field as InvoiceCursorSortField],
  };
}

export function resolveInvoiceCursorLimit(limit?: string): number {
  const parsed = Number.parseInt(limit ?? '', 10);
  const requested = Number.isFinite(parsed)
    ? parsed
    : INVOICE_CURSOR_DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), GLOBAL_LIST_LIMIT_MAX);
}

export function invoiceListFilterContext(query: InvoiceListQuery) {
  return { search: query.search?.trim() ?? '' };
}

/** Search words must all hit the first name, last name or company name of the customer. */
function customerNameMatch(
  tenantId: string,
  words: string[],
): Prisma.InvoiceWhereInput {
  return {
    customer: {
      is: {
        tenant_id: tenantId,
        AND: words.map((word) => ({
          OR: [
            { first_name: { contains: word, mode: 'insensitive' as const } },
            { last_name: { contains: word, mode: 'insensitive' as const } },
            { company_name: { contains: word, mode: 'insensitive' as const } },
          ],
        })),
      },
    },
  };
}

/** Same fields the list page searched client-side: number, customer name and status. */
export function buildInvoiceListWhere(
  tenantId: string,
  query: InvoiceListQuery,
): Prisma.InvoiceWhereInput {
  const search = query.search?.trim();
  if (!search) {
    return { tenant_id: tenantId };
  }
  const upper = search.toUpperCase();
  const statuses = Object.values(InvoiceStatus).filter((status) =>
    status.includes(upper),
  );
  return {
    tenant_id: tenantId,
    OR: [
      { invoice_number: { contains: search, mode: 'insensitive' } },
      customerNameMatch(tenantId, search.split(/\s+/)),
      ...(statuses.length > 0 ? [{ status: { in: statuses } }] : []),
    ],
  };
}
