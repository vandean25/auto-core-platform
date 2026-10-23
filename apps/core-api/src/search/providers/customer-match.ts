import type { Prisma } from '@prisma/client';
import { normalizePhone } from '../../customer/customer-phone.util.js';
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

function phoneDigitsWhere(
  tier: MatchTier,
  digits: string,
): Prisma.CustomerWhereInput | null {
  if (tier === 'contains') {
    return null;
  }
  return {
    phone_digits:
      tier === 'exact' ? { equals: digits } : { startsWith: digits },
  };
}

function phoneWhere(tier: MatchTier, text: string): Prisma.CustomerWhereInput {
  const or: Prisma.CustomerWhereInput[] = [];
  const normalized = normalizePhone(text);
  if (normalized) {
    const digitsFilter = phoneDigitsWhere(tier, normalized);
    if (digitsFilter) {
      or.push(digitsFilter);
    }
  }
  const compact = text.replace(/[\s/().-]/g, '');
  const variants = compact === text ? [text] : [text, compact];
  or.push(...variants.map((value) => ({ phone: tierFilter(tier, value) })));
  return { OR: or };
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
    case 'plate': // "A1" or "H2O" is plate-shaped but may be a customer name
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
