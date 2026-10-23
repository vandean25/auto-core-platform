import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  SEARCH_DEFAULT_LIMIT,
  type SearchQueryDto,
} from './dto/search-query.dto.js';
import type {
  SearchGroupDto,
  SearchResponseDto,
} from './dto/search-response.dto.js';
import { parseSearchQuery } from './search-query.parser.js';
import {
  SEARCH_PROVIDERS,
  type SearchContext,
  type SearchProvider,
  type SearchResult,
  type SiteScope,
} from './search.types.js';

const NO_SITES: SiteScope = { activeSiteId: null, siteIds: [] };

function hasSiteHits(settled: PromiseSettledResult<SearchResult[]>[]): boolean {
  return settled.some(
    (outcome) =>
      outcome.status === 'fulfilled' &&
      outcome.value.some((result) => result.siteId),
  );
}

/** Active-site hits first, then by score; the sort is stable so provider order breaks ties. */
function compareResults(activeSiteId: string | null) {
  const siteRank = (result: SearchResult) =>
    activeSiteId && result.siteId && result.siteId !== activeSiteId ? 1 : 0;
  return (a: SearchResult, b: SearchResult) =>
    siteRank(a) - siteRank(b) || b.score - a.score;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(SEARCH_PROVIDERS) private readonly providers: SearchProvider[],
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async search(dto: SearchQueryDto): Promise<SearchResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const role = this.tenantContext.getAuthenticatedUser()?.role ?? '';
    const selected = this.selectProviders(role, dto.types);
    if (selected.length === 0) {
      return { groups: [] };
    }
    let siteScope: Promise<SiteScope> | undefined;
    const ctx: SearchContext = {
      tenantId,
      role,
      query: parseSearchQuery(dto.q),
      limit: dto.limit ?? SEARCH_DEFAULT_LIMIT,
      getSiteScope: () => (siteScope ??= this.resolveSiteScope()),
    };
    const settled = await Promise.allSettled(
      selected.map((provider) => provider.search(ctx)),
    );
    const activeSiteId = hasSiteHits(settled)
      ? (await ctx.getSiteScope()).activeSiteId
      : null;
    return {
      groups: settled.map((outcome, index) =>
        this.toGroup(selected[index], outcome, activeSiteId, ctx.limit),
      ),
    };
  }

  /** The role check lives here, not in the providers, so a provider cannot forget it. */
  private selectProviders(
    role: string,
    types: SearchQueryDto['types'],
  ): SearchProvider[] {
    return this.providers.filter(
      (provider) =>
        provider.allowedRoles.includes(role) &&
        (!types || types.includes(provider.type)),
    );
  }

  /** Fails closed: without a resolvable scope, site-scoped providers see no site. */
  private async resolveSiteScope(): Promise<SiteScope> {
    try {
      const [site, siteIds] = await Promise.all([
        this.siteContext.tryGetSite(),
        this.siteContext.listAuthorizedSiteIds(),
      ]);
      return { activeSiteId: site?.id ?? null, siteIds };
    } catch (error) {
      this.logger.warn(`site scope unavailable error=${errorName(error)}`);
      return NO_SITES;
    }
  }

  private toGroup(
    provider: SearchProvider,
    outcome: PromiseSettledResult<SearchResult[]>,
    activeSiteId: string | null,
    limit: number,
  ): SearchGroupDto {
    if (outcome.status === 'rejected') {
      // Never log the query, names or titles: type and error class only.
      this.logger.warn(
        `search provider failed type=${provider.type} error=${errorName(outcome.reason)}`,
      );
      return { type: provider.type, results: [], error: 'unavailable' };
    }
    const results = [...outcome.value]
      .sort(compareResults(activeSiteId))
      .slice(0, limit);
    return { type: provider.type, results };
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}
