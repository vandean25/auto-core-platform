import {
  collectRanked,
  collectSiteRanked,
  TIER_SCORE,
  tierFilter,
} from './search-ranking.js';

type Row = { id: string };

describe('tierFilter', () => {
  it('maps tiers to case-insensitive Prisma string filters', () => {
    expect(tierFilter('exact', 'a')).toEqual({
      equals: 'a',
      mode: 'insensitive',
    });
    expect(tierFilter('prefix', 'a')).toEqual({
      startsWith: 'a',
      mode: 'insensitive',
    });
    expect(tierFilter('contains', 'a')).toEqual({
      contains: 'a',
      mode: 'insensitive',
    });
  });
});

describe('tierFilter wildcard escaping', () => {
  it.each(['exact', 'prefix', 'contains'] as const)(
    'escapes %% _ and backslash in the %s tier',
    (tier) => {
      const filter = tierFilter(tier, '100%_a\\b') as Record<string, string>;
      const value = filter.equals ?? filter.startsWith ?? filter.contains;
      expect(value).toBe('100\\%\\_a\\\\b');
    },
  );
});

describe('collectRanked', () => {
  const byTier: Record<string, Row[]> = {
    exact: [{ id: 'b' }],
    prefix: [{ id: 'b' }, { id: 'c' }],
    contains: [{ id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'a' }],
  };

  it('ranks exact above prefix above contains and de-duplicates by id', async () => {
    const out = await collectRanked(10, (tier) =>
      Promise.resolve(byTier[tier]),
    );
    expect(out.map((r) => [r.row.id, r.score])).toEqual([
      ['b', TIER_SCORE.exact],
      ['c', TIER_SCORE.prefix],
      ['d', TIER_SCORE.contains],
      ['a', TIER_SCORE.contains],
    ]);
  });

  it('keeps the database order inside a tier and stops at the limit', async () => {
    const out = await collectRanked(3, (tier) => Promise.resolve(byTier[tier]));
    expect(out.map((r) => r.row.id)).toEqual(['b', 'c', 'd']);
  });

  it('runs only the requested tiers', async () => {
    const fetch = jest.fn((tier: string) => Promise.resolve(byTier[tier]));
    await collectRanked(5, fetch, ['exact']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('exact');
  });
});

describe('collectSiteRanked', () => {
  const hitsBySite: Record<string, Row[]> = {
    'site-a': [{ id: 'a1' }, { id: 'a2' }],
    'site-b': [{ id: 'b1' }],
    'site-c': [{ id: 'c1' }],
  };
  const fetch = jest.fn((_tier: string, siteIds: string[]) =>
    Promise.resolve(siteIds.flatMap((id) => hitsBySite[id] ?? [])),
  );

  beforeEach(() => fetch.mockClear());

  it('returns active-site hits first, then hits of the other authorized sites', async () => {
    const out = await collectSiteRanked(
      5,
      { activeSiteId: 'site-b', siteIds: ['site-a', 'site-b', 'site-c'] },
      fetch,
      ['exact'],
    );
    expect(out.map((r) => r.row.id)).toEqual(['b1', 'a1', 'a2', 'c1']);
  });

  it('never queries a site outside the authorized list', async () => {
    await collectSiteRanked(
      5,
      { activeSiteId: 'site-x', siteIds: ['site-a'] },
      fetch,
      ['exact'],
    );
    const queried = fetch.mock.calls.flatMap(([, siteIds]) => siteIds);
    expect(queried).toEqual(['site-a']);
  });

  it('treats all authorized sites alike without an active site', async () => {
    const out = await collectSiteRanked(
      5,
      { activeSiteId: null, siteIds: ['site-a'] },
      fetch,
      ['exact'],
    );
    expect(out.map((r) => r.row.id)).toEqual(['a1', 'a2']);
  });

  it('returns nothing and queries nothing without authorized sites', async () => {
    const out = await collectSiteRanked(
      5,
      { activeSiteId: null, siteIds: [] },
      fetch,
    );
    expect(out).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caps the combined result at the limit with the active site first', async () => {
    const out = await collectSiteRanked(
      2,
      { activeSiteId: 'site-b', siteIds: ['site-a', 'site-b'] },
      fetch,
      ['exact'],
    );
    expect(out.map((r) => r.row.id)).toEqual(['b1', 'a1']);
  });
});
