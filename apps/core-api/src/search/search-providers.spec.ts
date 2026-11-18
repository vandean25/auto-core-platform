import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createSearchProviders } from './search-providers.js';
import { parseSearchQuery } from './search-query.parser.js';
import {
  SEARCH_RESULT_TYPES,
  type SearchContext,
  type SearchProvider,
  type SearchResultType,
  type SiteScope,
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

const REPO_ROOT = fs.existsSync(path.resolve(process.cwd(), 'locales'))
  ? process.cwd()
  : path.resolve(process.cwd(), '../..');

type ProviderFixture = {
  model: string;
  q: string;
  row: Record<string, unknown>;
};

const PROVIDER_FIXTURES: Record<SearchResultType, ProviderFixture> = {
  customer: {
    model: 'customer',
    q: 'Max Mustermann',
    row: {
      id: 'c1',
      first_name: 'Max',
      last_name: 'Mustermann',
      company_name: null,
      email: null,
      phone: null,
    },
  },
  vehicle: {
    model: 'vehicle',
    q: 'W 12345 A',
    row: {
      id: 'v1',
      make: 'VW',
      model: 'Golf',
      plate: 'W 12345 A',
      vin: null,
      site_id: null,
    },
  },
  stock_vehicle: {
    model: 'vehicle',
    q: 'W 12345 A',
    row: {
      id: 'sv1',
      make: 'VW',
      model: 'Golf',
      plate: 'W 12345 A',
      vin: null,
      site_id: 'site-a',
    },
  },
  workshop_order: {
    model: 'workshopOrder',
    q: 'WO-2026-1',
    row: {
      id: 'wo1',
      order_number: 'WO-2026-1',
      site_id: 'site-a',
      customer: null,
      vehicle: { make: 'VW', model: 'Golf', plate: 'W 12345 A' },
    },
  },
  appointment: {
    model: 'workshopOrder',
    q: 'WO-2026-1',
    row: {
      id: 'app1',
      order_number: 'WO-2026-1',
      site_id: 'site-a',
      scheduled_start_at: new Date('2026-10-24T09:00:00.000Z'),
      customer: null,
      vehicle: { make: 'VW', model: 'Golf', plate: 'W 12345 A' },
    },
  },
  estimate: {
    model: 'workshopEstimate',
    q: 'KV-2026-1',
    row: {
      id: 'est1',
      estimate_number: 'KV-2026-1',
      site_id: 'site-a',
      workshop_order_id: 'wo1',
      workshop_order: {
        order_number: 'WO-2026-1',
        customer: null,
        vehicle: { plate: 'W 12345 A' },
      },
    },
  },
  sales_order: {
    model: 'salesOrder',
    q: 'SO-2026-1',
    row: {
      id: 'so1',
      order_number: 'SO-2026-1',
      site_id: 'site-a',
      customer: {
        first_name: 'Max',
        last_name: 'Mustermann',
        company_name: null,
      },
      vehicle: null,
    },
  },
  vehicle_sale: {
    model: 'vehicleSale',
    q: 'VS-2026-1',
    row: {
      id: 'vs1',
      sale_number: 'VS-2026-1',
      site_id: 'site-a',
      customer: {
        first_name: 'Max',
        last_name: 'Mustermann',
        company_name: null,
      },
      vehicle: { make: 'VW', model: 'Golf', plate: 'W 12345 A' },
    },
  },
  invoice: {
    model: 'invoice',
    q: 'RE-2026-1',
    row: {
      id: 'inv1',
      invoice_number: 'RE-2026-1',
      site_id: 'site-a',
      customer: {
        first_name: 'Max',
        last_name: 'Mustermann',
        company_name: null,
      },
      vehicle: null,
    },
  },
  credit_note: {
    model: 'creditNote',
    q: 'GS-2026-1',
    row: {
      id: 'cn1',
      credit_number: 'GS-2026-1',
      site_id: 'site-a',
      original_invoice: {
        invoice_number: 'RE-2026-1',
        customer: {
          first_name: 'Max',
          last_name: 'Mustermann',
          company_name: null,
        },
      },
    },
  },
  part: {
    model: 'catalogItem',
    q: 'brake pad',
    row: { id: 'p1', sku: 'BP-1', name: 'Brake pad' },
  },
  labor_operation: {
    model: 'laborOperation',
    q: 'AW-100',
    row: { id: 'lo1', code: 'AW-100', description: 'Oil service' },
  },
  vendor: {
    model: 'vendor',
    q: 'Bosch',
    row: {
      id: 'vnd1',
      name: 'Bosch GmbH',
      email: 'orders@bosch.example.test',
      account_number: '70001',
    },
  },
  purchase_order: {
    model: 'purchaseOrder',
    q: 'PO-2026-1',
    row: {
      id: 'po1',
      order_number: 'PO-2026-1',
      site_id: 'site-a',
      vendor: { name: 'Bosch GmbH' },
    },
  },
  purchase_invoice: {
    model: 'purchaseInvoice',
    q: 'ER-2026-1',
    row: {
      id: 'pi1',
      invoice_number: 'ER-2026-1',
      vendor_invoice_number: 'VND-991',
      vendor: { name: 'Bosch GmbH' },
    },
  },
  employee: {
    model: 'employee',
    q: 'Anna',
    row: { id: 'emp1', name: 'Anna Gruber', user: null },
  },
  user: {
    model: 'tenantMember',
    q: 'anna@example.test',
    row: {
      id: 'tm1',
      user: {
        email: 'anna@example.test',
        firstName: 'Anna',
        lastName: 'Gruber',
      },
    },
  },
  legal_entity: {
    model: 'legalEntity',
    q: 'Autohaus',
    row: {
      id: 'le1',
      name: 'Autohaus Wien GmbH',
      tax_number: 'ATU12345678',
      registration_number: 'FN 123456a',
    },
  },
  site: {
    model: 'site',
    q: 'Wien',
    row: {
      id: 'site1',
      name: 'Standort Wien',
      code: 'VIE',
      address_city: 'Wien',
    },
  },
};

function readFrontendSearchGroups(): Record<string, string> {
  const filePath = path.join(
    REPO_ROOT,
    'apps/core-web/src/components/global-search/global-search-types.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const groups: Record<string, string> = {};

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'SEARCH_TYPE_REGISTRY' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isObjectLiteralExpression(prop.initializer)
        ) {
          const typeKey = prop.name.getText(sf).replace(/['"]/g, '');
          const labelProp = prop.initializer.properties.find(
            (p) =>
              ts.isPropertyAssignment(p) &&
              p.name.getText(sf).replace(/['"]/g, '') === 'labelKey',
          );
          if (
            labelProp &&
            ts.isPropertyAssignment(labelProp) &&
            ts.isStringLiteral(labelProp.initializer)
          ) {
            groups[typeKey] = labelProp.initializer.text;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return groups;
}

function readAppRoutePatterns(): string[] {
  const filePath = path.join(
    REPO_ROOT,
    'apps/core-web/src/lib/app-route-paths.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const routes: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'APP_ROUTE_PATHS' &&
      node.initializer
    ) {
      const expr = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isObjectLiteralExpression(expr)) {
        for (const prop of expr.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isStringLiteral(prop.initializer)
          ) {
            routes.push(prop.initializer.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return routes;
}

function readLocaleSearchGroups(lang: 'de' | 'en'): Record<string, string> {
  const filePath = path.join(REPO_ROOT, 'locales', lang, 'nav.json');
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    globalSearch?: { groups?: Record<string, string> };
  };
  return json.globalSearch?.groups ?? {};
}

function matchesAppRoute(href: string, routePatterns: string[]): boolean {
  const pathname = href.split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  return routePatterns.some((pattern) => {
    const patternSegments = pattern.split('/').filter(Boolean);
    if (patternSegments.length !== segments.length) return false;
    return patternSegments.every(
      (seg, idx) => seg.startsWith(':') || seg === segments[idx],
    );
  });
}

function validateProviderRegistryEntry(
  entry: { type: string; allowedRoles: readonly string[]; sampleHref: string },
  frontendGroups: Record<string, string>,
  deGroups: Record<string, string>,
  enGroups: Record<string, string>,
  routePatterns: string[],
): void {
  if (entry.allowedRoles.length === 0) {
    throw new Error(`Search provider "${entry.type}" has empty allowedRoles`);
  }
  const labelKey = frontendGroups[entry.type];
  if (!labelKey) {
    throw new Error(
      `Search provider "${entry.type}" has no entry in frontend SEARCH_TYPE_REGISTRY`,
    );
  }
  const groupKey = labelKey.replace(/^nav:globalSearch\.groups\./, '');
  if (!deGroups[groupKey] || !enGroups[groupKey]) {
    throw new Error(
      `Search provider "${entry.type}" is missing de/en nav.json label for "${labelKey}"`,
    );
  }
  if (!matchesAppRoute(entry.sampleHref, routePatterns)) {
    throw new Error(
      `Search provider "${entry.type}" href "${entry.sampleHref}" does not match any APP_ROUTE_PATHS record route`,
    );
  }
}

function assertProviderQueryContract(
  p: SearchProvider,
  calls: Call[],
  tenantId: string,
  limit: number,
): void {
  if (p.allowedRoles.length === 0) {
    throw new Error(`Search provider "${p.type}" has empty allowedRoles`);
  }
  if (calls.length === 0) {
    throw new Error(`Search provider "${p.type}" issued no Prisma calls`);
  }
  for (const call of calls) {
    if (call.method !== 'findMany') {
      throw new Error(
        `Search provider "${p.type}" used disallowed Prisma method ${call.method}`,
      );
    }
    if (call.args?.where?.tenant_id !== tenantId) {
      throw new Error(
        `Search provider "${p.type}" omitted tenant_id=${tenantId} in where clause`,
      );
    }
    if (call.args?.take !== limit) {
      throw new Error(
        `Search provider "${p.type}" must set take=${limit}, got ${String(call.args?.take)}`,
      );
    }
    if (!call.args?.select || call.args?.include !== undefined) {
      throw new Error(
        `Search provider "${p.type}" must use select without include`,
      );
    }
  }
}

const SENSITIVE_COLUMN_RE =
  /^(iban|bic|.*_encrypted|.*secret.*|password|password_hash|.*token.*|birth_date|date_of_birth|tax_id)$/i;

function findSensitiveColumnUsages(
  fileName: string,
  sourceText: string,
): string[] {
  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const hits: string[] = [];

  function checkName(raw: string) {
    const clean = raw.replace(/['"]/g, '');
    if (SENSITIVE_COLUMN_RE.test(clean)) {
      hits.push(`${path.basename(fileName)}:${clean}`);
    }
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      checkName(node.name.getText(sf));
    } else if (ts.isShorthandPropertyAssignment(node)) {
      checkName(node.name.text);
    } else if (ts.isPropertyAccessExpression(node)) {
      checkName(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

describe('createSearchProviders (registry guards)', () => {
  const { prisma } = createPrismaMock();
  const providers = createSearchProviders(prisma);
  const frontendGroups = readFrontendSearchGroups();
  const deGroups = readLocaleSearchGroups('de');
  const enGroups = readLocaleSearchGroups('en');
  const routePatterns = readAppRoutePatterns();

  it('registers every SEARCH_RESULT_TYPES entry once without duplicates', () => {
    const types = providers.map((p) => p.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual([...SEARCH_RESULT_TYPES]);
  });

  it('has a frontend group, de/en i18n key, non-empty allowedRoles and valid record route for every registered provider', async () => {
    for (const p of providers) {
      const fixture = PROVIDER_FIXTURES[p.type];
      expect(fixture).toBeDefined();
      const { prisma: rowPrisma } = createPrismaMock({
        [fixture.model]: [fixture.row],
      });
      const hits = await provider(
        createSearchProviders(rowPrisma),
        p.type,
      ).search(ctx(fixture.q));
      expect(hits.length).toBeGreaterThan(0);

      validateProviderRegistryEntry(
        {
          type: p.type,
          allowedRoles: p.allowedRoles,
          sampleHref: hits[0].href,
        },
        frontendGroups,
        deGroups,
        enGroups,
        routePatterns,
      );
    }
  });

  it('fails naming the type when a fixture provider lacks a frontend group, record route, or de/en key', () => {
    expect(() =>
      validateProviderRegistryEntry(
        {
          type: 'missing_group_fixture',
          allowedRoles: ['ADMIN'],
          sampleHref: '/customers/c1',
        },
        frontendGroups,
        deGroups,
        enGroups,
        routePatterns,
      ),
    ).toThrow(/missing_group_fixture/);

    expect(() =>
      validateProviderRegistryEntry(
        {
          type: 'missing_route_fixture',
          allowedRoles: ['ADMIN'],
          sampleHref: '/non-existent-record-route/x1',
        },
        { ...frontendGroups, missing_route_fixture: 'nav:globalSearch.groups.customer' },
        deGroups,
        enGroups,
        routePatterns,
      ),
    ).toThrow(/missing_route_fixture/);

    expect(() =>
      validateProviderRegistryEntry(
        {
          type: 'missing_i18n_fixture',
          allowedRoles: ['ADMIN'],
          sampleHref: '/customers/c1',
        },
        { ...frontendGroups, missing_i18n_fixture: 'nav:globalSearch.groups.nonExistentKey' },
        deGroups,
        enGroups,
        routePatterns,
      ),
    ).toThrow(/missing_i18n_fixture/);
  });

  it('enforces findMany, tenant_id from context, take: limit, select-only and id tie-breaker for every registered provider', async () => {
    for (const p of providers) {
      const fixture = PROVIDER_FIXTURES[p.type];
      const { prisma: mockPrismaA, calls: callsA } = createPrismaMock();
      await provider(createSearchProviders(mockPrismaA), p.type).search(
        ctx(fixture.q),
      );
      assertProviderQueryContract(p, callsA, 'tenant-a', 5);
      for (const call of callsA) {
        expect(call.model).toBe(fixture.model);
        expect(call.args.orderBy.at(-1)).toEqual({ id: 'asc' });
      }

      const { prisma: mockPrismaB, calls: callsB } = createPrismaMock();
      await provider(createSearchProviders(mockPrismaB), p.type).search(
        ctx(fixture.q, { tenantId: 'tenant-b' }),
      );
      assertProviderQueryContract(p, callsB, 'tenant-b', 5);
    }
  });

  it('fails when a fixture provider skips tenant_id or has empty allowedRoles', () => {
    const noTenantProvider: SearchProvider = {
      type: 'customer',
      allowedRoles: ['ADMIN'],
      search: async () => [],
    };
    const noTenantCalls: Call[] = [
      {
        model: 'customer',
        method: 'findMany',
        args: {
          where: { last_name: { contains: 'Max' } },
          select: { id: true },
          take: 5,
        },
      },
    ];
    expect(() =>
      assertProviderQueryContract(noTenantProvider, noTenantCalls, 'tenant-a', 5),
    ).toThrow(/tenant_id/);

    const emptyRolesProvider: SearchProvider = {
      type: 'customer',
      allowedRoles: [],
      search: async () => [],
    };
    expect(() =>
      assertProviderQueryContract(emptyRolesProvider, noTenantCalls, 'tenant-a', 5),
    ).toThrow(/allowedRoles/);
  });

  it('never touches denylisted sensitive or encrypted columns in any provider', () => {
    const providersDir = path.join(REPO_ROOT, 'apps/core-api/src/search/providers');
    const files = fs
      .readdirSync(providersDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    const allHits = files.flatMap((file) => {
      const fullPath = path.join(providersDir, file);
      return findSensitiveColumnUsages(fullPath, fs.readFileSync(fullPath, 'utf8'));
    });
    expect(allHits).toEqual([]);
  });

  it('detects denylisted sensitive columns in a negative fixture provider', () => {
    const badProviderSource = `
      const SELECT = { id: true, iban: true, ssn_encrypted: true, api_secret: true };
      const where = { bic: { equals: 'RZKTAT2K' }, password: 'x', reset_token: 'y' };
    `;
    const hits = findSensitiveColumnUsages('bad-provider.ts', badProviderSource);
    expect(hits).toEqual([
      'bad-provider.ts:iban',
      'bad-provider.ts:ssn_encrypted',
      'bad-provider.ts:api_secret',
      'bad-provider.ts:bic',
      'bad-provider.ts:password',
      'bad-provider.ts:reset_token',
    ]);
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

  it('matches phone input on phone_digits, exact and prefix only', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('+43 664 1234567'));
    const phoneDigitFilters = findMany.mock.calls.map(([{ where }]) =>
      where.OR?.find((c: { phone_digits?: unknown }) => c.phone_digits),
    );
    expect(phoneDigitFilters).toEqual([
      { phone_digits: { equals: '06641234567' } },
      { phone_digits: { startsWith: '06641234567' } },
      undefined,
    ]);
  });

  it.each([
    '+43 664 1234567',
    '0664/1234567',
    '0664-123 45 67',
    '06641234567',
  ])('normalises full phone search %p to the same phone_digits key', async (q) => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx(q));
    const exactWhere = findMany.mock.calls[0][0].where;
    const digitsClause = exactWhere.OR?.find(
      (c: { phone_digits?: { equals?: string } }) => c.phone_digits?.equals,
    );
    expect(digitsClause?.phone_digits?.equals).toBe('06641234567');
  });

  it('matches a typed phone prefix on phone_digits', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ customer: { findMany } } as never),
      'customer',
    ).search(ctx('0664 12'));
    const prefixWhere = findMany.mock.calls[1][0].where;
    const prefixClause = prefixWhere.OR?.find(
      (c: { phone_digits?: { startsWith?: string } }) =>
        c.phone_digits?.startsWith,
    );
    expect(prefixClause?.phone_digits?.startsWith).toBe('066412');
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

describe('external id (incadea) matching and new providers', () => {
  it('matches customers and vehicles by external_id on exact/prefix tiers and omits contains', async () => {
    const extFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ entity_id: 'c1' }])
      .mockResolvedValueOnce([]);
    const custFindMany = jest.fn().mockResolvedValue([
      {
        id: 'c1',
        first_name: 'Max',
        last_name: 'Mustermann',
        company_name: null,
        email: null,
        phone: null,
      },
    ]);
    const custHits = await provider(
      createSearchProviders({
        customer: { findMany: custFindMany },
        externalIdMapping: { findMany: extFindMany },
      } as never),
      'customer',
    ).search(ctx('00123'));

    expect(custHits.map((h) => [h.id, h.score])).toEqual([['c1', 1]]);
    expect(extFindMany).toHaveBeenCalledTimes(2);
    expect(extFindMany.mock.calls[0][0].where).toEqual({
      tenant_id: 'tenant-a',
      entity_type: 'CUSTOMER',
      external_id: { equals: '00123', mode: 'insensitive' },
    });

    const vehExtFindMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ entity_id: 'v1' }]);
    const vehFindMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'v1',
          make: 'VW',
          model: 'Golf',
          plate: 'W 123 A',
          vin: null,
          site_id: null,
        },
      ]);
    const vehHits = await provider(
      createSearchProviders({
        vehicle: { findMany: vehFindMany },
        externalIdMapping: { findMany: vehExtFindMany },
      } as never),
      'vehicle',
    ).search(ctx('FZ-99'));

    expect(vehHits.map((h) => [h.id, h.score])).toEqual([['v1', 0.8]]);
  });

  it('filters appointments to scheduled orders and redacts TECH customer contact', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ workshopOrder: { findMany } } as never),
      'appointment',
    ).search(
      ctx('WO-2026-1', {
        role: 'TECH',
        siteScope: { activeSiteId: 'site-a', siteIds: ['site-a'] },
      }),
    );
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({
      scheduled_start_at: { not: null },
    });

    const emailCalls = jest.fn().mockResolvedValue([]);
    await provider(
      createSearchProviders({ workshopOrder: { findMany: emailCalls } } as never),
      'appointment',
    ).search(ctx('max@example.com', { role: 'TECH' }));
    expect(emailCalls).not.toHaveBeenCalled();
  });

  it('searches finalized credit notes only and restricts HR/company providers to OWNER/ADMIN', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const providers = createSearchProviders({ creditNote: { findMany } } as never);
    await provider(providers, 'credit_note').search(
      ctx('GS-2026-1', {
        siteScope: { activeSiteId: 'site-a', siteIds: ['site-a'] },
      }),
    );
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({
      credit_number: { not: null },
    });

    for (const adminType of ['employee', 'user', 'legal_entity', 'site'] as const) {
      expect(provider(providers, adminType).allowedRoles).toEqual([
        'OWNER',
        'ADMIN',
      ]);
    }
  });
});

