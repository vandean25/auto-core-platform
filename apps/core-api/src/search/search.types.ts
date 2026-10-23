export const SEARCH_RESULT_TYPES = [
  'customer',
  'vehicle',
  'stock_vehicle',
  'workshop_order',
  'invoice',
  'part',
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export type SearchQueryKind =
  'uuid' | 'email' | 'vin' | 'phone' | 'number' | 'plate' | 'name';

export interface ParsedSearchQuery {
  /** Trimmed input with inner whitespace collapsed. */
  text: string;
  kind: SearchQueryKind;
  /** Normalised plate when the input is plate-shaped, even if `kind` is `number`. */
  plate: string | null;
  /** Whitespace-separated words, capped like the workshop name search. */
  terms: string[];
}

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  score: number;
  siteId?: string;
}

/** Sites the caller may see: `siteIds` are active memberships of the current tenant, never request input. */
export interface SiteScope {
  activeSiteId: string | null;
  siteIds: string[];
}

export interface SearchContext {
  /** From the tenant context only. */
  tenantId: string;
  role: string;
  query: ParsedSearchQuery;
  limit: number;
  /** Resolved on first call only, so providers without a site rule cost no site queries. */
  getSiteScope: () => Promise<SiteScope>;
}

export interface SearchProvider {
  readonly type: SearchResultType;
  /** Session roles that may receive this type; enforced by SearchService. */
  readonly allowedRoles: readonly string[];
  search(ctx: SearchContext): Promise<SearchResult[]>;
}

/** Injection token holding the ordered provider list (a later ticket can filter it per tenant). */
export const SEARCH_PROVIDERS = Symbol('SEARCH_PROVIDERS');
