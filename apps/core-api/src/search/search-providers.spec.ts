import { createSearchProviders } from './search-providers.js';
import { parseSearchQuery } from './search-query.parser.js';
import type {
  SearchContext,
  SearchProvider,
  SearchResultType,
  SiteScope,
} from './search.types.js';

type Call = { model: string; method: string; args: any };

/** Any Prisma method other than findMany (count, aggregate, groupBy, $queryRaw, ...) fails the test. */
function createPrismaMock(rowsByModel: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  const prisma = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_t, method: string) => (args: unknown) => {
              calls.push({ model, method, args });
              if (method !== 'findMany') {
                throw new Error(`search path must not call ${model}.${method}`);
              }
              return Promise.resolve(rowsByModel[model] ?? []);
            },
          },
        ),
    },
  );
  return { prisma: prisma as never, calls };
}

function ctx(
  q: string,
  overrides: Partial<Omit<SearchContext, 'getSiteScope'>> & {
    siteScope?: SiteScope;
  } = {},
): SearchContext {
  const { siteScope, ...rest } = overrides;
  const scope = siteScope ?? {
    activeSiteId: 'site-a',
    siteIds: ['site-a', 'site-b'],
  };
  return {
    tenantId: 'tenant-a',
    role: 'ADMIN',
    query: parseSearchQuery(q),
    limit: 5,
    getSiteScope: () => Promise.resolve(scope),
    ...rest,
  };
}

function provider(
  providers: SearchProvider[],
  type: SearchResultType,
): SearchProvider {
  return providers.find((p) => p.type === type)!;
}

describe('createSearchProviders (registry)', () => {
  const { prisma } = createPrismaMock();
  const providers = createSearchProviders(prisma);

  it('registers the six types once, in response order', () => {
    expect(providers.map((p) => p.type)).toEqual([
      'customer',
      'vehicle',
      'stock_vehicle',
      'workshop_order',
      'invoice',
      'part',
    ]);
  });

  it('declares the default role matrix per provider', () => {
    const roles = Object.fromEntries(
      providers.map((p) => [p.type, [...p.allowedRoles]]),
    );
    expect(roles).toEqual({
      customer: ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO'],
      vehicle: ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO'],
      stock_vehicle: ['OWNER', 'ADMIN', 'SALES', 'DEMO'],
      workshop_order: ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO'],
      invoice: ['OWNER', 'ADMIN', 'SALES', 'DEMO'],
      part: ['OWNER', 'ADMIN', 'SALES', 'DEMO'],
    });
  });
});

describe.each<[SearchResultType, string, string]>([
  ['customer', 'customer', 'Max Mustermann'],
  ['vehicle', 'vehicle', 'W 12345 A'],
  ['stock_vehicle', 'vehicle', 'W 12345 A'],
  ['workshop_order', 'workshopOrder', 'WO-2026-1'],
  ['invoice', 'invoice', 'RE-2026-1'],
  ['part', 'catalogItem', 'brake pad'],
])('%s provider query shape', (type, model, q) => {
  it('only uses findMany with tenant_id from the context, take: limit and a select', async () => {
    const { prisma, calls } = createPrismaMock();
    await provider(createSearchProviders(prisma), type).search(ctx(q));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.model).toBe(model);
      expect(call.method).toBe('findMany');
      expect(call.args.where.tenant_id).toBe('tenant-a');
      expect(call.args.take).toBe(5);
      expect(call.args.select).toBeDefined();
      expect(call.args.include).toBeUndefined();
      expect(call.args.orderBy.at(-1)).toEqual({ id: 'asc' });
    }
  });

  it('never trusts a tenant id other than the context one', async () => {
    const { prisma, calls } = createPrismaMock();
    await provider(createSearchProviders(prisma), type).search(
      ctx(q, { tenantId: 'tenant-b' }),
    );
    expect(calls.every((c) => c.args.where.tenant_id === 'tenant-b')).toBe(
      true,
    );
  });
});

describe('result mapping and ranking', () => {
  it('scores exact above prefix above contains and de-duplicates', async () => {
    const row = {
      id: 'c1',
      first_name: 'Max',
      last_name: 'Muster',
      company_name: null,
      email: null,
      phone: null,
    };
    const other = { ...row, id: 'c2' };
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([row]) // exact
      .mockResolvedValueOnce([row, other]) // prefix
      .mockResolvedValueOnce([row, other]); // contains
    const results = await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('Max'));
    expect(results.map((r) => [r.id, r.score])).toEqual([
      ['c1', 1],
      ['c2', 0.8],
    ]);
    expect(results[0]).toMatchObject({
      type: 'customer',
      title: 'Max Muster',
      href: '/customers/c1',
    });
  });
});

describe('customer provider and the TECH restriction', () => {
  it('selects no email or phone for TECH and returns name only', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'c1',
        first_name: 'Max',
        last_name: 'Muster',
        company_name: null,
      },
    ]);
    const results = await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('Muster', { role: 'TECH' }));
    for (const [args] of findMany.mock.calls) {
      expect(args.select).toEqual({
        id: true,
        first_name: true,
        last_name: true,
        company_name: true,
      });
    }
    expect(results[0].subtitle).toBeNull();
    expect(JSON.stringify(results)).not.toMatch(/email|phone/i);
  });

  it.each(['max@example.com', '+43 664 1234567'])(
    'does not let TECH probe contact data with %s',
    async (q) => {
      const findMany = jest.fn().mockResolvedValue([]);
      await provider(
        createSearchProviders({ customer: { findMany } } as never),
        'customer',
      ).search(ctx(q, { role: 'TECH' }));
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('shows email or phone as subtitle for non-TECH roles', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'c1',
        first_name: 'Max',
        last_name: 'Muster',
        company_name: null,
        email: 'max@example.com',
        phone: null,
      },
    ]);
    const [result] = await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('max@example.com'));
    expect(result.subtitle).toBe('max@example.com');
  });

  it('looks an email up exact and as prefix, never as contains', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('max@exa'));
    expect(findMany.mock.calls.map(([a]) => a.where.email)).toEqual([
      { equals: 'max@exa', mode: 'insensitive' },
      { startsWith: 'max@exa', mode: 'insensitive' },
    ]);
  });

  it('also searches names for plate-shaped input such as A1', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('A1'));
    expect(findMany.mock.calls[0][0].where.AND).toHaveLength(1);
  });

  it('matches every name word in any order', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('mustermann max'));
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
  });
});

describe('vehicle providers and the shared plate normaliser', () => {
  it('matches a plate typed with spaces, hyphens or dots on plate_normalized, exact and prefix only', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ vehicle: { findMany } } as never),
      'vehicle',
    ).search(ctx('w-12345.a'));
    const plateFilters = findMany.mock.calls.map(([{ where }]) =>
      where.OR.find((c: any) => c.plate_normalized),
    );
    expect(plateFilters).toEqual([
      { plate_normalized: { equals: 'W12345A' } },
      { plate_normalized: { startsWith: 'W12345A' } },
      undefined, // contains tier has no plate predicate
    ]);
    for (const [{ where }] of findMany.mock.calls) {
      expect(JSON.stringify(where)).not.toContain('"plate":');
    }
  });

  it('matches a VIN fragment of 6+ characters as prefix and suffix', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ vehicle: { findMany } } as never),
      'vehicle',
    ).search(ctx('zzz1kzaw123456'));
    const vinFilters = findMany.mock.calls.map(
      ([{ where }]) => where.OR.find((c: any) => c.vin).vin,
    );
    expect(vinFilters).toEqual([
      { equals: 'ZZZ1KZAW123456', mode: 'insensitive' },
      { startsWith: 'ZZZ1KZAW123456', mode: 'insensitive' },
      { endsWith: 'ZZZ1KZAW123456', mode: 'insensitive' },
    ]);
  });

  it('does not search the VIN for fragments shorter than 6 characters', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ vehicle: { findMany } } as never),
      'vehicle',
    ).search(ctx('4711a'));
    for (const [{ where }] of findMany.mock.calls) {
      expect(JSON.stringify(where)).not.toContain('"vin"');
    }
  });

  it('also searches make and model for plate-shaped input such as X5', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ vehicle: { findMany } } as never),
      'vehicle',
    ).search(ctx('X5'));
    const { where } = findMany.mock.calls[0][0];
    expect(where.OR).toContainEqual({
      AND: [
        {
          OR: [
            { make: { equals: 'X5', mode: 'insensitive' } },
            { model: { equals: 'X5', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('keeps customer vehicles apart from dealer stock', async () => {
    const vehicleFind = jest.fn().mockResolvedValue([]);
    const stockFind = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ vehicle: { findMany: vehicleFind } } as never),
      'vehicle',
    ).search(ctx('golf'));
    await provider(
      createSearchProviders({ vehicle: { findMany: stockFind } } as never),
      'stock_vehicle',
    ).search(ctx('golf'));
    const vehicleWhere = vehicleFind.mock.calls[0][0].where;
    const stockWhere = stockFind.mock.calls[0][0].where;
    expect(vehicleWhere.inventory_role).toBe('CUSTOMER');
    expect(stockWhere.inventory_role).toEqual({ in: ['USED', 'NEW', 'DEMO'] });
    expect(stockWhere.stock_status).toEqual({ not: null });
    expect(stockWhere.site_id).toBe('site-a');
  });

  it('returns no dealer stock without an authorized active site', async () => {
    const findMany = jest.fn();
    const providers = createSearchProviders({ vehicle: { findMany } } as never);
    const noActive = ctx('golf', {
      siteScope: { activeSiteId: null, siteIds: ['site-a'] },
    });
    const foreignActive = ctx('golf', {
      siteScope: { activeSiteId: 'site-x', siteIds: ['site-a'] },
    });
    await expect(
      provider(providers, 'stock_vehicle').search(noActive),
    ).resolves.toEqual([]);
    await expect(
      provider(providers, 'stock_vehicle').search(foreignActive),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('site-aware providers', () => {
  it.each([
    ['workshop_order', 'workshopOrder', 'WO-2026-1'],
    ['invoice', 'invoice', 'RE-2026-1'],
  ] as const)(
    '%s queries the active site and the other authorized sites separately, never an unlisted site',
    async (type, model, q) => {
      const findMany = jest.fn().mockResolvedValue([]);
      await provider(
        createSearchProviders({ [model]: { findMany } } as never),
        type,
      ).search(ctx(q));
      const siteFilters = findMany.mock.calls.map(([a]) => a.where.site_id.in);
      expect(new Set(siteFilters.map((s: string[]) => s.join()))).toEqual(
        new Set(['site-a', 'site-b']),
      );
      expect(siteFilters.flat()).not.toContain('site-x');
    },
  );

  it('returns siteId on hits and active-site hits first', async () => {
    const row = (id: string, site_id: string) => ({
      id,
      order_number: `WO-${id}`,
      site_id,
      customer: null,
      vehicle: { make: 'VW', model: 'Golf', plate: 'W1A' },
    });
    const findMany = jest.fn(({ where }: any) =>
      Promise.resolve(
        where.site_id.in[0] === 'site-a'
          ? [row('a', 'site-a')]
          : [row('b', 'site-b')],
      ),
    );
    const results = await provider(
      createSearchProviders({ workshopOrder: { findMany } } as never),
      'workshop_order',
    ).search(ctx('WO-2026-1'));
    expect(results.map((r) => [r.id, r.siteId])).toEqual([
      ['a', 'site-a'],
      ['b', 'site-b'],
    ]);
  });

  it('queries nothing without authorized sites', async () => {
    const findMany = jest.fn();
    const results = await provider(
      createSearchProviders({ workshopOrder: { findMany } } as never),
      'workshop_order',
    ).search(
      ctx('WO-2026-1', { siteScope: { activeSiteId: null, siteIds: [] } }),
    );
    expect(results).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('workshop order provider and the TECH restriction', () => {
  it.each(['max@example.com', '+43 664 1234567'])(
    'does not let TECH probe customer contact data through orders with %s',
    async (q) => {
      const findMany = jest.fn().mockResolvedValue([]);
      await provider(
        createSearchProviders({ workshopOrder: { findMany } } as never),
        'workshop_order',
      ).search(ctx(q, { role: 'TECH' }));
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('still lets non-TECH roles find orders by customer email', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ workshopOrder: { findMany } } as never),
      'workshop_order',
    ).search(ctx('max@example.com'));
    expect(findMany).toHaveBeenCalled();
  });

  it('scopes the nested customer and vehicle filters to the tenant', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ workshopOrder: { findMany } } as never),
      'workshop_order',
    ).search(ctx('Max'));
    const { where } = findMany.mock.calls[0][0];
    for (const clause of where.OR) {
      const nested = clause.customer ?? clause.vehicle;
      expect(nested.tenant_id).toBe('tenant-a');
    }
  });
});

describe('invoice and part providers', () => {
  it('searches issued invoices only', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ invoice: { findMany } } as never),
      'invoice',
    ).search(
      ctx('RE-2026-1', {
        siteScope: { activeSiteId: 'site-a', siteIds: ['site-a'] },
      }),
    );
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({
      invoice_number: { not: null },
    });
  });

  it('skips the query for input a part cannot match (email, phone, VIN)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const part = provider(
      createSearchProviders({ catalogItem: { findMany } } as never),
      'part',
    );
    await part.search(ctx('max@example.com'));
    await part.search(ctx('+43 664 1234567'));
    await part.search(ctx('WVWZZZ1KZAW123456'));
    expect(findMany).not.toHaveBeenCalled();
  });

  it('links a part to its ledger with an encoded SKU and no siteId', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'p1', sku: 'BP 1/2', name: 'Brake pad' }]);
    const [result] = await provider(
      createSearchProviders({ catalogItem: { findMany } } as never),
      'part',
    ).search(ctx('brake'));
    expect(result).toMatchObject({
      type: 'part',
      title: 'Brake pad',
      subtitle: 'BP 1/2',
      href: '/inventory/p1/ledger?sku=BP%201%2F2',
    });
    expect(result.siteId).toBeUndefined();
  });
});
