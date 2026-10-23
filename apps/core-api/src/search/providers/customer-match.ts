import type { Prisma } from '@prisma/client';
import { tierFilter, type MatchTier } from '../search-ranking.js';
import type { ParsedSearchQuery } from '../search.types.js';

/** Every term must hit first name, last name or company name, so "max mustermann" works in either order. */
export function customerNameWhere(
  tier: MatchTier,
  terms: string[],
): Prisma.CustomerWhereInput {
  return {
    AND: terms.map((term) => ({
      OR: [
        { first_name: tierFilter(tier, term) },
        { last_name: tierFilter(tier, term) },
        { company_name: tierFilter(tier, term) },
      ],
    })),
  };
}

// shortcut: phones match the stored formatting only (typed or separator-free), no stored normalised column; upgrade with a normalised phone column.
function phoneWhere(tier: MatchTier, text: string): Prisma.CustomerWhereInput {
  const compact = text.replace(/[\s/().-]/g, '');
  const variants = compact === text ? [text] : [text, compact];
  return { OR: variants.map((value) => ({ phone: tierFilter(tier, value) })) };
}

/**
 * Customer predicate for name, email and phone input; `null` when the input says nothing about a customer.
 * `restricted` (TECH) matches names only, so contact data cannot be probed.
 */
export function customerMatchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
  restricted: boolean,
): Prisma.CustomerWhereInput | null {
  switch (query.kind) {
    case 'uuid':
      return { id: query.text.toLowerCase() };
    case 'name':
      return customerNameWhere(tier, query.terms);
    case 'email':
      // Exact and prefix only: an address is looked up whole or as typed so far.
      return restricted || tier === 'contains'
        ? null
        : { email: tierFilter(tier, query.text) };
    case 'phone':
      return restricted ? null : phoneWhere(tier, query.text);
    default:
      return null;
  }
}
