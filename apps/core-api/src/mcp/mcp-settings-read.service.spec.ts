import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from '../document-branding/theme-v1.js';
import { McpSettingsReadService } from './mcp-settings-read.service.js';
import { encodeMcpCursor } from './mcp-output.util.js';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type FindArgs = {
  where?: Where;
  select?: Record<string, boolean>;
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  skip?: number;
  take?: number;
};

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const USER_A = 'firebase-user-a';
const USER_WITHOUT_SITE = 'firebase-user-without-site';

const SITE_A_MAIN = '00000000-0000-4000-8000-0000000000a1';
const SITE_A_EXTRA = '00000000-0000-4000-8000-0000000000a2';
const SITE_A_ARCHIVED = '00000000-0000-4000-8000-0000000000a3';
const SITE_B_MAIN = '00000000-0000-4000-8000-0000000000b1';
const LEGAL_ENTITY_A = '00000000-0000-4000-8000-0000000000e1';
const LEGAL_ENTITY_A_INACTIVE = '00000000-0000-4000-8000-0000000000e3';
const LEGAL_ENTITY_B = '00000000-0000-4000-8000-0000000000e2';

const IBAN_A = 'AT611904300234573201';
const IBAN_B = 'DE89370400440532013000';
const SECRET_PROJECT_B = 'tenant-b-voice-project';
const SECRET_BLOB_B = 'TENANT-B-ENCRYPTED-SERVICE-ACCOUNT';
const SECRET_REF_B = 'projects/tenant-b/secrets/catalog-key';
const REPRESENTATIVE_A = 'Erika Beispiel';

const CURRENT_YEAR = new Date().getFullYear();

function decimal(value: string) {
  return {
    toFixed: (decimalPlaces: number) => Number(value).toFixed(decimalPlaces),
    toString: () => value,
  };
}

/**
 * In-memory tables with the Prisma filtering and selection the service relies
 * on. Every table is filtered by tenant_id only when the query names it, so a
 * missing tenant filter would show up as another tenant's rows here.
 */
const tables = {
  users: [
    { id: 'user-a', firebaseUid: USER_A },
    { id: 'user-without-site', firebaseUid: USER_WITHOUT_SITE },
  ] as Row[],
  tenantMembers: [
    { tenant_id: TENANT_A, user_id: 'user-a', is_active: true },
    { tenant_id: TENANT_A, user_id: 'user-without-site', is_active: true },
  ] as Row[],
  siteMemberships: [
    {
      tenant_id: TENANT_A,
      user_id: 'user-a',
      site_id: SITE_A_MAIN,
      is_active: true,
    },
  ] as Row[],
  sites: [
    {
      id: SITE_A_MAIN,
      tenant_id: TENANT_A,
      legal_entity_id: LEGAL_ENTITY_A,
      code: 'MAIN',
      name: 'Hauptstandort',
      is_active: true,
      timezone: 'Europe/Vienna',
      address_street: 'Testgasse 1',
      address_zip: '1010',
      address_city: 'Wien',
      address_country: 'AT',
    },
    {
      id: SITE_A_EXTRA,
      tenant_id: TENANT_A,
      legal_entity_id: LEGAL_ENTITY_A,
      code: 'EXT',
      name: 'Zweigstelle',
      is_active: true,
      timezone: 'Europe/Vienna',
      address_street: null,
      address_zip: '8010',
      address_city: 'Graz',
      address_country: null,
    },
    {
      id: SITE_A_ARCHIVED,
      tenant_id: TENANT_A,
      legal_entity_id: LEGAL_ENTITY_A,
      code: 'ARC',
      name: 'Archiv',
      is_active: false,
      timezone: 'Europe/Vienna',
      address_street: null,
      address_zip: null,
      address_city: null,
      address_country: null,
    },
    {
      id: SITE_B_MAIN,
      tenant_id: TENANT_B,
      legal_entity_id: LEGAL_ENTITY_B,
      code: 'MAIN',
      name: 'Standort B',
      is_active: true,
      timezone: 'Europe/Berlin',
      address_street: 'Bgasse 9',
      address_zip: '10115',
      address_city: 'Berlin',
      address_country: 'DE',
    },
  ] as Row[],
  legalEntities: [
    {
      id: LEGAL_ENTITY_A,
      tenant_id: TENANT_A,
      name: 'Test Werkstatt GmbH',
      country_iso: 'AT',
      is_active: true,
      address_street: 'Testgasse 1',
      address_line2: null,
      address_zip: '1010',
      address_city: 'Wien',
      tax_number: '12 345/6789',
      vat_id: 'ATU12345678',
      iban: IBAN_A,
      bic: 'TESTATWW',
      bank_name: 'Testbank Wien',
      email: 'office@example.invalid',
      phone: '+43 1 000000',
      registration_number: 'FN 000000 x',
      registration_court: 'Handelsgericht Wien',
      representatives: REPRESENTATIVE_A,
      payment_terms_days: 14,
      payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
    },
    {
      id: LEGAL_ENTITY_A_INACTIVE,
      tenant_id: TENANT_A,
      name: 'Stillgelegt GmbH',
      country_iso: 'AT',
      is_active: false,
      address_street: null,
      address_line2: null,
      address_zip: null,
      address_city: null,
      tax_number: null,
      vat_id: null,
      iban: null,
      bic: null,
      bank_name: null,
      email: null,
      phone: null,
      registration_number: null,
      registration_court: null,
      representatives: null,
      payment_terms_days: null,
      payment_terms_text: null,
    },
    {
      id: LEGAL_ENTITY_B,
      tenant_id: TENANT_B,
      name: 'Zweite Firma GmbH',
      country_iso: 'DE',
      is_active: true,
      address_street: 'Bgasse 9',
      address_line2: null,
      address_zip: '10115',
      address_city: 'Berlin',
      tax_number: null,
      vat_id: 'DE123456789',
      iban: IBAN_B,
      bic: 'TESTDEBB',
      bank_name: 'Testbank Berlin',
      email: null,
      phone: null,
      registration_number: null,
      registration_court: null,
      representatives: null,
      payment_terms_days: 30,
      payment_terms_text: 'Netto',
    },
  ] as Row[],
  legalEntityAccountingProfiles: [] as Row[],
  revenueGroups: [
    {
      id: 1,
      tenant_id: TENANT_A,
      name: 'Service',
      tax_rate: decimal('20'),
      account_number: '8400',
      is_default: true,
    },
    {
      id: 2,
      tenant_id: TENANT_B,
      name: 'Fremd',
      tax_rate: decimal('19'),
      account_number: '8000',
      is_default: true,
    },
  ] as Row[],
  financeSettings: [
    {
      tenant_id: TENANT_A,
      sales_order_prefix: 'SO-2026-',
      next_sales_order_number: 1001,
      workshop_order_prefix: 'WO-2026-',
      next_workshop_order_number: 57,
      vehicle_purchase_prefix: 'VP-2026-',
      next_vehicle_purchase_number: 3,
      vehicle_sale_prefix: 'VS-2026-',
      next_vehicle_sale_number: 4,
      stock_transfer_prefix: 'TR-2026-',
      next_stock_transfer_number: 5,
    },
    {
      tenant_id: TENANT_B,
      sales_order_prefix: 'SO-B-2026-',
      next_sales_order_number: 7,
      workshop_order_prefix: 'WO-B-2026-',
      next_workshop_order_number: 3,
      vehicle_purchase_prefix: 'VP-B-2026-',
      next_vehicle_purchase_number: 1,
      vehicle_sale_prefix: 'VS-B-2026-',
      next_vehicle_sale_number: 1,
      stock_transfer_prefix: 'TR-B-2026-',
      next_stock_transfer_number: 1,
    },
  ] as Row[],
  invoiceSequences: [
    { tenant_id: TENANT_A, year: CURRENT_YEAR, current: 41 },
    { tenant_id: TENANT_B, year: CURRENT_YEAR, current: 900 },
  ] as Row[],
  creditNoteSequences: [
    { tenant_id: TENANT_B, year: CURRENT_YEAR, current: 77 },
  ] as Row[],
  workshopEstimateSequences: [
    { tenant_id: TENANT_B, year: CURRENT_YEAR, current: 5 },
  ] as Row[],
  voiceTranslationSettings: [
    {
      tenant_id: TENANT_A,
      target_language_code: 'de',
      google_project_id: 'tenant-a-voice-project',
      google_service_account_encrypted: 'tenant-a-encrypted-blob',
    },
    {
      tenant_id: TENANT_B,
      target_language_code: 'en',
      google_project_id: SECRET_PROJECT_B,
      google_service_account_encrypted: SECRET_BLOB_B,
    },
  ] as Row[],
  catalogProviderSettings: [
    {
      tenant_id: TENANT_B,
      default_identity_adapter_id: 'identity-b',
      default_parts_aftermarket_adapter_id: null,
      default_labor_aftermarket_adapter_id: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: SECRET_REF_B,
      parts_aftermarket_credentials_secret_ref: null,
      labor_aftermarket_credentials_secret_ref: null,
    },
  ] as Row[],
  tyreStorageSettings: [
    {
      tenant_id: TENANT_B,
      summer_swap_month: 4,
      summer_swap_day: 15,
      winter_swap_month: 11,
      winter_swap_day: 1,
      due_for_swap_days: 14,
    },
  ] as Row[],
  documentBrandProfiles: [
    {
      tenant_id: TENANT_A,
      legal_entity_id: LEGAL_ENTITY_A,
      active_revision: 2,
      confirmed_at: new Date('2026-09-01T10:00:00.000Z'),
      active_logo_asset_id: 'tenant-a-logo-asset',
      active_theme: { ...DEFAULT_DOCUMENT_BRAND_THEME, headerText: 'Kopf A' },
      draft_theme: null,
    },
    {
      tenant_id: TENANT_B,
      legal_entity_id: LEGAL_ENTITY_B,
      active_revision: 1,
      confirmed_at: null,
      active_logo_asset_id: null,
      active_theme: null,
      draft_theme: null,
    },
  ] as Row[],
};

const TABLE_BY_DELEGATE = {
  user: tables.users,
  tenantMember: tables.tenantMembers,
  siteMembership: tables.siteMemberships,
  site: tables.sites,
  legalEntity: tables.legalEntities,
  legalEntityAccountingProfile: tables.legalEntityAccountingProfiles,
  revenueGroup: tables.revenueGroups,
  financeSettings: tables.financeSettings,
  invoiceSequence: tables.invoiceSequences,
  creditNoteSequence: tables.creditNoteSequences,
  workshopEstimateSequence: tables.workshopEstimateSequences,
  voiceTranslationSettings: tables.voiceTranslationSettings,
  catalogProviderSettings: tables.catalogProviderSettings,
  tyreStorageSettings: tables.tyreStorageSettings,
  documentBrandProfile: tables.documentBrandProfiles,
};

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (
      condition !== null &&
      typeof condition === 'object' &&
      'in' in condition
    ) {
      return (condition as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === condition;
  });
}

function pick(row: Row, select: Record<string, boolean>): Row {
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, selected]) => selected)
      .map(([key]) => [key, row[key]]),
  );
}

function query(rows: Row[], args: FindArgs = {}): Row[] {
  let result = rows.filter((row) => matches(row, args.where ?? {}));
  const orders = Array.isArray(args.orderBy)
    ? args.orderBy
    : args.orderBy
      ? [args.orderBy]
      : [];
  if (orders.length > 0) {
    result = [...result].sort((a, b) => {
      for (const order of orders) {
        const [key, direction] = Object.entries(order)[0];
        const left = String(a[key]);
        const right = String(b[key]);
        if (left !== right) {
          const sign = left < right ? -1 : 1;
          return direction === 'desc' ? -sign : sign;
        }
      }
      return 0;
    });
  }
  const start = args.skip ?? 0;
  result = result.slice(
    start,
    args.take === undefined ? undefined : start + args.take,
  );
  return args.select ? result.map((row) => pick(row, args.select!)) : result;
}

/**
 * `findUnique` is refused on tenant-scoped models, as the tenant isolation
 * extension refuses it, so a service that used it would fail these tests. The
 * global `User` table is exempt, as in the extension.
 */
function delegate(rows: Row[], { global = false } = {}) {
  return {
    findFirst: jest.fn(
      async (args: FindArgs = {}) => query(rows, args)[0] ?? null,
    ),
    findMany: jest.fn(async (args: FindArgs = {}) => query(rows, args)),
    findUnique: jest.fn(
      async (args: { where: Where; select?: Record<string, boolean> }) => {
        if (!global) {
          throw new Error(
            '[TenantIsolation] Do not use findUnique() on a tenant-scoped model.',
          );
        }
        return (
          query(rows, { where: args.where, select: args.select })[0] ?? null
        );
      },
    ),
  };
}

/**
 * Read delegates only. A write call would throw "is not a function", so a
 * service that tried to write would fail these tests.
 */
function createPrisma() {
  return Object.fromEntries(
    Object.entries(TABLE_BY_DELEGATE).map(([name, rows]) => [
      name,
      delegate(rows, { global: name === 'user' }),
    ]),
  ) as unknown as PrismaService & Record<string, ReturnType<typeof delegate>>;
}

function createService(options: {
  tenantId?: string;
  userId?: string;
  role?: string;
  activeSiteId?: string | null;
}) {
  const prisma = createPrisma();
  const tenantId = options.tenantId ?? TENANT_A;
  const tenantContext = {
    getTenantId: jest.fn(async () => tenantId),
    getAuthenticatedUser: jest.fn(() => ({
      userId: options.userId ?? USER_A,
      tenantId,
      role: options.role ?? 'SALES',
    })),
  } as unknown as TenantContextService;
  const activeSiteId =
    options.activeSiteId === undefined ? SITE_A_MAIN : options.activeSiteId;
  const siteContext = {
    findSiteId: jest.fn(async () => activeSiteId),
    getSiteId: jest.fn(async () => {
      if (!activeSiteId) {
        throw new ForbiddenException('Active site is required');
      }
      return activeSiteId;
    }),
  } as unknown as SiteContextService;
  const decisionLiveApply = {
    resolveEffectiveMode: jest.fn(async () => 'shadow'),
  } as unknown as DecisionLiveApplyService;
  const service = new McpSettingsReadService(
    decisionLiveApply,
    prisma,
    siteContext,
    tenantContext,
  );
  return { service, prisma };
}

describe('McpSettingsReadService (AUT-457)', () => {
  describe('getLegalEntity', () => {
    it('reads the legal entity of the active site, scoped to the session tenant', async () => {
      const { service, prisma } = createService({});

      const result = await service.getLegalEntity({});

      expect(result.id).toBe(LEGAL_ENTITY_A);
      expect(prisma.legalEntity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: LEGAL_ENTITY_A, tenant_id: TENANT_A },
        }),
      );
    });

    it('returns NotFound for a legal entity of another tenant', async () => {
      const { service } = createService({});

      await expect(
        service.getLegalEntity({ legal_entity_id: LEGAL_ENTITY_B }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns NotFound when the active site is not in the session tenant', async () => {
      const { service } = createService({ activeSiteId: SITE_B_MAIN });

      await expect(service.getLegalEntity({})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reads an inactive legal entity of the same tenant when named', async () => {
      const { service } = createService({});

      await expect(
        service.getLegalEntity({ legal_entity_id: LEGAL_ENTITY_A_INACTIVE }),
      ).resolves.toMatchObject({
        id: LEGAL_ENTITY_A_INACTIVE,
        is_active: false,
      });
    });

    it('masks every bank identifier and never returns the representatives', async () => {
      const { service } = createService({});

      const result = await service.getLegalEntity({});
      const serialized = JSON.stringify(result);

      expect(result.bank).toEqual({
        iban: '****3201',
        bic: '****ATWW',
        bank_name: '****Wien',
      });
      expect(serialized).not.toContain(IBAN_A);
      expect(serialized).not.toContain('TESTATWW');
      expect(serialized).not.toContain(REPRESENTATIVE_A);
    });

    it('reports the tenant tax rates and the current year number ranges', async () => {
      const { service } = createService({});

      const result = await service.getLegalEntity({});

      expect(result.tax_rates).toEqual([
        {
          name: 'Service',
          tax_rate: '20.00',
          account_number: '8400',
          is_default: true,
        },
      ]);
      expect(result.number_ranges).toContainEqual({
        document: 'invoice',
        year: CURRENT_YEAR,
        prefix: `RE-${CURRENT_YEAR}-`,
        next_number: 42,
      });
      expect(result.number_ranges).toContainEqual({
        document: 'sales_order',
        year: null,
        prefix: 'SO-2026-',
        next_number: 1001,
      });
    });

    it('reads each number sequence for the session tenant and the current year', async () => {
      const { service, prisma } = createService({});

      await service.getLegalEntity({});

      expect(prisma.invoiceSequence.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_A, year: CURRENT_YEAR },
        }),
      );
      expect(prisma.creditNoteSequence.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_A, year: CURRENT_YEAR },
        }),
      );
    });

    it('reads only the number ranges, tax rates, and seller of its own tenant', async () => {
      const { service } = createService({
        tenantId: TENANT_B,
        role: 'ADMIN',
        activeSiteId: SITE_B_MAIN,
      });

      const result = await service.getLegalEntity({});

      expect(result.seller.name).toBe('Zweite Firma GmbH');
      expect(result.tax_rates).toEqual([
        {
          name: 'Fremd',
          tax_rate: '19.00',
          account_number: '8000',
          is_default: true,
        },
      ]);
      expect(result.number_ranges).toEqual(
        expect.arrayContaining([
          {
            document: 'invoice',
            year: CURRENT_YEAR,
            prefix: `RE-${CURRENT_YEAR}-`,
            next_number: 901,
          },
          {
            document: 'credit_note',
            year: CURRENT_YEAR,
            prefix: `CN-${CURRENT_YEAR}-`,
            next_number: 78,
          },
          {
            document: 'workshop_estimate',
            year: CURRENT_YEAR,
            prefix: `KV-${CURRENT_YEAR}-`,
            next_number: 6,
          },
          {
            document: 'sales_order',
            year: null,
            prefix: 'SO-B-2026-',
            next_number: 7,
          },
        ]),
      );
    });

    it('does not show another tenant sequence when the tenant has none', async () => {
      const { service } = createService({});

      const result = await service.getLegalEntity({});

      expect(result.number_ranges).toEqual(
        expect.arrayContaining([
          {
            document: 'credit_note',
            year: CURRENT_YEAR,
            prefix: `CN-${CURRENT_YEAR}-`,
            next_number: 1,
          },
          {
            document: 'workshop_estimate',
            year: CURRENT_YEAR,
            prefix: `KV-${CURRENT_YEAR}-`,
            next_number: 1,
          },
          {
            document: 'sales_order',
            year: null,
            prefix: 'SO-2026-',
            next_number: 1001,
          },
        ]),
      );
    });

    it('reports a missing accounting profile as not configured', async () => {
      const { service } = createService({});

      const result = await service.getLegalEntity({});

      expect(result.accounting_profile).toMatchObject({
        configured: false,
        is_enabled: false,
        is_ready: false,
      });
    });

    it('never reads another tenant revenue group into the result', async () => {
      const { service } = createService({});

      const result = await service.getLegalEntity({});

      expect(JSON.stringify(result)).not.toContain('Fremd');
    });
  });

  describe('listSites', () => {
    it('lists only the active sites of the session tenant for a member with a site membership', async () => {
      const { service } = createService({});

      const result = await service.listSites({});
      const ids = result.data.map((row) => row.id);

      expect(ids).toEqual([SITE_A_EXTRA, SITE_A_MAIN]);
      expect(ids).not.toContain(SITE_A_ARCHIVED);
      expect(ids).not.toContain(SITE_B_MAIN);
      expect(result.data.every((row) => row.active)).toBe(true);
      expect(result.meta).toEqual({ page_size: 10, next_cursor: null });
    });

    it('returns the row fields id, name, address summary, and active', async () => {
      const { service } = createService({});

      const [main] = (await service.listSites({})).data.filter(
        (row) => row.id === SITE_A_MAIN,
      );

      expect(main).toEqual({
        id: SITE_A_MAIN,
        name: 'Hauptstandort',
        address_summary: 'Testgasse 1, 1010 Wien, AT',
        active: true,
      });
    });

    it('refuses a member without an active site membership', async () => {
      const { service } = createService({ userId: USER_WITHOUT_SITE });

      await expect(service.listSites({})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lists inactive sites for ADMIN without requiring a site membership', async () => {
      const { service } = createService({
        userId: USER_WITHOUT_SITE,
        role: 'ADMIN',
      });

      const result = await service.listSites({});

      expect(result.data.map((row) => row.id)).toEqual(
        expect.arrayContaining([SITE_A_ARCHIVED, SITE_A_MAIN, SITE_A_EXTRA]),
      );
      expect(
        result.data.find((row) => row.id === SITE_A_ARCHIVED)?.active,
      ).toBe(false);
    });

    it('pages with pageSize and an opaque cursor, without gaps or repeats', async () => {
      const { service } = createService({ role: 'OWNER' });

      const first = await service.listSites({ pageSize: 2 });
      expect(first.data).toHaveLength(2);
      expect(first.meta).toEqual({
        page_size: 2,
        next_cursor: encodeMcpCursor(2),
      });

      const second = await service.listSites({
        pageSize: 2,
        cursor: first.meta.next_cursor ?? undefined,
      });
      expect(second.meta.next_cursor).toBeNull();

      const seen = [...first.data, ...second.data].map((row) => row.id);
      expect(seen).toEqual([SITE_A_ARCHIVED, SITE_A_EXTRA, SITE_A_MAIN]);
    });

    it('rejects a cursor that does not decode to an offset', async () => {
      const { service } = createService({});

      await expect(
        service.listSites({ cursor: 'bm90LWFuLW9mZnNldA' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never returns another tenant site', async () => {
      const { service } = createService({
        tenantId: TENANT_B,
        userId: USER_A,
        role: 'ADMIN',
      });

      const result = await service.listSites({});

      expect(result.data.map((row) => row.id)).toEqual([SITE_B_MAIN]);
    });
  });

  describe('getTenantSettings', () => {
    it('returns the settings of the session tenant only', async () => {
      const { service } = createService({});

      const result = await service.getTenantSettings();
      const serialized = JSON.stringify(result);

      expect(result.currency).toBe('EUR');
      expect(result.active_site_timezone).toBe('Europe/Vienna');
      expect(result.feature_flags.voice_translation).toEqual({
        target_language_code: 'de',
        configured: true,
      });
      expect(serialized).not.toContain(SECRET_PROJECT_B);
      expect(serialized).not.toContain('Berlin');
      expect(serialized).not.toContain('identity-b');
      expect(result.feature_flags.tyre_storage.summer_swap_date).toBe('03-01');
    });

    it('never returns the voice service account, the project ID, or a credential secret reference', async () => {
      const { service } = createService({
        tenantId: TENANT_B,
        role: 'ADMIN',
        activeSiteId: SITE_B_MAIN,
      });

      const result = await service.getTenantSettings();
      const serialized = JSON.stringify(result);

      expect(result.active_site_timezone).toBe('Europe/Berlin');
      expect(result.feature_flags.voice_translation).toEqual({
        target_language_code: 'en',
        configured: true,
      });
      expect(result.feature_flags.tyre_storage.summer_swap_date).toBe('04-15');
      expect(result.feature_flags.catalog.credentials_configured.identity).toBe(
        true,
      );
      expect(serialized).not.toContain(SECRET_PROJECT_B);
      expect(serialized).not.toContain(SECRET_BLOB_B);
      expect(serialized).not.toContain(SECRET_REF_B);
    });

    it('lists the branding of the active legal entities of the session tenant only', async () => {
      const { service } = createService({});

      const result = await service.getTenantSettings();

      expect(
        result.document_branding.map((row) => row.legal_entity_id),
      ).toEqual([LEGAL_ENTITY_A]);
      expect(result.document_branding[0]).toMatchObject({
        is_confirmed: true,
        active_revision: 2,
        has_logo: true,
        theme: { header_text_set: true, footer_text_set: false },
      });
      expect(JSON.stringify(result)).not.toContain('tenant-a-logo-asset');
      expect(JSON.stringify(result)).not.toContain('Kopf A');
    });

    it('does not read the timezone of an active site that belongs to another tenant', async () => {
      const { service } = createService({ activeSiteId: SITE_B_MAIN });

      const result = await service.getTenantSettings();

      expect(result.active_site_timezone).toBeNull();
    });

    it('reports no active site timezone when the session has no valid active site', async () => {
      const { service } = createService({ activeSiteId: null });

      const result = await service.getTenantSettings();

      expect(result.active_site_timezone).toBeNull();
    });
  });
});
