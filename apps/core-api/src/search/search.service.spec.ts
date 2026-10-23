import { Logger } from '@nestjs/common';
import { SearchService } from './search.service.js';
import type {
  SearchContext,
  SearchProvider,
  SearchResult,
  SearchResultType,
} from './search.types.js';

const ALL_TYPES: SearchResultType[] = [
  'customer',
  'vehicle',
  'stock_vehicle',
  'workshop_order',
  'invoice',
  'part',
];

function hit(
  type: SearchResultType,
  id: string,
  score: number,
  siteId?: string,
): SearchResult {
  return {
    type,
    id,
    title: `title-${id}`,
    subtitle: null,
    href: `/x/${id}`,
    score,
    ...(siteId ? { siteId } : {}),
  };
}

function fakeProvider(
  type: SearchResultType,
  allowedRoles: string[],
  search: (ctx: SearchContext) => Promise<SearchResult[]> = () =>
    Promise.resolve([]),
): SearchProvider & { search: jest.Mock } {
  return { type, allowedRoles, search: jest.fn(search) };
}

function buildService(
  providers: SearchProvider[],
  role: string,
  site: { active?: string | null; authorized?: string[] } = {},
) {
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-a'),
    getAuthenticatedUser: jest.fn().mockReturnValue({ role }),
  };
  const siteContext = {
    tryGetSite: jest
      .fn()
      .mockResolvedValue(site.active ? { id: site.active } : null),
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(site.authorized ?? []),
  };
  const service = new SearchService(
    providers,
    tenantContext as never,
    siteContext as never,
  );
  return { service, tenantContext, siteContext };
}

describe('SearchService', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

  beforeEach(() => warn.mockClear());

  describe('role filter', () => {
    const matrix: Record<string, SearchResultType[]> = {
      OWNER: ALL_TYPES,
      ADMIN: ALL_TYPES,
      SALES: ALL_TYPES,
      TECH: ['customer', 'vehicle', 'workshop_order'],
      DEMO: ALL_TYPES,
      API_KEY: [],
    };
    const providersFor = () =>
      ALL_TYPES.map((type) =>
        fakeProvider(
          type,
          type === 'customer' || type === 'vehicle' || type === 'workshop_order'
            ? ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO']
            : ['OWNER', 'ADMIN', 'SALES', 'DEMO'],
        ),
      );

    it.each(Object.entries(matrix))(
      '%s receives only its types',
      async (role, expected) => {
        const { service } = buildService(providersFor(), role);
        const res = await service.search({ q: 'max' });
        expect(res.groups.map((g) => g.type)).toEqual(expected);
      },
    );

    it('does not call a provider the role may not see, even when requested', async () => {
      const providers = providersFor();
      const { service } = buildService(providers, 'TECH');
      const res = await service.search({
        q: 'max',
        types: ['invoice', 'customer'],
      });
      expect(res.groups.map((g) => g.type)).toEqual(['customer']);
      expect(providers[4].search).not.toHaveBeenCalled();
    });
  });

  it('limits the response to the requested types in registry order', async () => {
    const providers = ALL_TYPES.map((t) => fakeProvider(t, ['ADMIN']));
    const { service } = buildService(providers, 'ADMIN');
    const res = await service.search({ q: 'max', types: ['part', 'customer'] });
    expect(res.groups.map((g) => g.type)).toEqual(['customer', 'part']);
  });

  it('passes the tenant from the context, the parsed query and the default limit', async () => {
    const provider = fakeProvider('customer', ['ADMIN']);
    const { service } = buildService([provider], 'ADMIN');
    await service.search({ q: 'W 12345 A' });
    const ctx = provider.search.mock.calls[0][0] as SearchContext;
    expect(ctx).toMatchObject({
      tenantId: 'tenant-a',
      role: 'ADMIN',
      limit: 5,
      query: { kind: 'plate', plate: 'W12345A' },
    });
  });

  describe('partial failure', () => {
    it('marks only the failing group unavailable and returns the others', async () => {
      const providers = [
        fakeProvider('customer', ['ADMIN'], () =>
          Promise.resolve([hit('customer', 'c1', 1)]),
        ),
        fakeProvider('vehicle', ['ADMIN'], () =>
          Promise.reject(new TypeError('db down for Max Mustermann')),
        ),
        fakeProvider('part', ['ADMIN'], () =>
          Promise.resolve([hit('part', 'p1', 0.5)]),
        ),
      ];
      const { service } = buildService(providers, 'ADMIN');
      const res = await service.search({ q: 'Max Mustermann' });
      expect(res.groups).toEqual([
        { type: 'customer', results: [hit('customer', 'c1', 1)] },
        { type: 'vehicle', results: [], error: 'unavailable' },
        { type: 'part', results: [hit('part', 'p1', 0.5)] },
      ]);
    });

    it('logs type and error class only, never the query or the error message', async () => {
      const providers = [
        fakeProvider('vehicle', ['ADMIN'], () =>
          Promise.reject(new TypeError('db down for Max Mustermann')),
        ),
      ];
      const { service } = buildService(providers, 'ADMIN');
      await service.search({ q: 'Max Mustermann' });
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toBe('search provider failed type=vehicle error=TypeError');
      expect(line).not.toMatch(/Max|Mustermann/);
    });
  });

  describe('site rule', () => {
    const siteProvider = (hits: SearchResult[]) =>
      fakeProvider('workshop_order', ['ADMIN'], async (ctx) => {
        await ctx.getSiteScope();
        return hits;
      });

    it('orders active-site hits before other-site hits, then by score', async () => {
      const provider = siteProvider([
        hit('workshop_order', 'other-exact', 1, 'site-b'),
        hit('workshop_order', 'active-contains', 0.5, 'site-a'),
        hit('workshop_order', 'active-exact', 1, 'site-a'),
        hit('workshop_order', 'other-prefix', 0.8, 'site-b'),
      ]);
      const { service } = buildService([provider], 'ADMIN', {
        active: 'site-a',
        authorized: ['site-a', 'site-b'],
      });
      const res = await service.search({ q: '4711' });
      expect(res.groups[0].results.map((r) => r.id)).toEqual([
        'active-exact',
        'active-contains',
        'other-exact',
        'other-prefix',
      ]);
    });

    it('hands the provider only the authorized sites from the site context', async () => {
      const provider = siteProvider([]);
      const { service } = buildService([provider], 'ADMIN', {
        active: 'site-a',
        authorized: ['site-a', 'site-b'],
      });
      await service.search({ q: '4711' });
      const ctx = provider.search.mock.calls[0][0] as SearchContext;
      await expect(ctx.getSiteScope()).resolves.toEqual({
        activeSiteId: 'site-a',
        siteIds: ['site-a', 'site-b'],
      });
    });

    it('resolves the site scope only when a provider asks for it', async () => {
      const { service, siteContext } = buildService(
        [fakeProvider('customer', ['ADMIN'])],
        'ADMIN',
      );
      await service.search({ q: 'max' });
      expect(siteContext.tryGetSite).not.toHaveBeenCalled();
      expect(siteContext.listAuthorizedSiteIds).not.toHaveBeenCalled();
    });

    it('resolves the site scope once for several providers', async () => {
      const providers = [
        siteProvider([hit('workshop_order', 'o1', 1, 'site-a')]),
        fakeProvider('invoice', ['ADMIN'], async (ctx) => {
          await ctx.getSiteScope();
          return [hit('invoice', 'i1', 1, 'site-a')];
        }),
      ];
      const { service, siteContext } = buildService(providers, 'ADMIN', {
        active: 'site-a',
        authorized: ['site-a'],
      });
      await service.search({ q: '4711' });
      expect(siteContext.tryGetSite).toHaveBeenCalledTimes(1);
      expect(siteContext.listAuthorizedSiteIds).toHaveBeenCalledTimes(1);
    });

    it('fails closed with an empty scope when the site lookup throws', async () => {
      const provider = siteProvider([]);
      const { service, siteContext } = buildService([provider], 'ADMIN');
      siteContext.listAuthorizedSiteIds.mockRejectedValue(new Error('boom'));
      await service.search({ q: '4711' });
      const ctx = provider.search.mock.calls[0][0] as SearchContext;
      await expect(ctx.getSiteScope()).resolves.toEqual({
        activeSiteId: null,
        siteIds: [],
      });
    });
  });

  it('keeps the provider order for equal scores (stable)', async () => {
    const provider = fakeProvider('part', ['ADMIN'], () =>
      Promise.resolve([
        hit('part', 'b', 0.5),
        hit('part', 'a', 0.5),
        hit('part', 'c', 0.8),
      ]),
    );
    const { service } = buildService([provider], 'ADMIN');
    const res = await service.search({ q: 'pad' });
    expect(res.groups[0].results.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('caps each group at the requested limit', async () => {
    const provider = fakeProvider('part', ['ADMIN'], () =>
      Promise.resolve([
        hit('part', 'a', 1),
        hit('part', 'b', 1),
        hit('part', 'c', 1),
      ]),
    );
    const { service } = buildService([provider], 'ADMIN');
    const res = await service.search({ q: 'pad', limit: 2 });
    expect(res.groups[0].results).toHaveLength(2);
  });
});
