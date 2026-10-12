import type { Prisma } from '@prisma/client';

/**
 * Name matching uses at most this many words. Extra words are ignored, so one
 * request cannot build an unbounded where clause.
 */
export const MAX_CUSTOMER_NAME_TERMS = 5;

/**
 * Splits free-text search input on whitespace. Empty fragments are dropped, so
 * "  max   mustermann " yields ['max', 'mustermann'].
 */
export function splitSearchTerms(query: string): string[] {
  if (!query) return [];
  return query
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, MAX_CUSTOMER_NAME_TERMS);
}

/**
 * A single search term that must appear in at least one customer name column.
 * Combined with AND across terms, so "max mustermann" finds first_name "Max" and
 * last_name "Mustermann" in either order, which a whole-query contains never does.
 */
export function customerNameTermWhere(term: string): Prisma.CustomerWhereInput {
  return {
    OR: [
      { first_name: { contains: term, mode: 'insensitive' } },
      { last_name: { contains: term, mode: 'insensitive' } },
      { company_name: { contains: term, mode: 'insensitive' } },
    ],
  };
}
