import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CatalogOemConcernCode } from '@prisma/client';
import { SANDBOX_CATALOG_ADAPTER_IDS } from '../catalog/catalog-adapter-ids';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderSettingsController } from './catalog-provider-settings.controller';
import { CatalogProviderSettingsService } from './catalog-provider-settings.service';

const tenantId = 'tenant-1';

const mockPrisma = {
  catalogProviderSettings: {
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  catalogOemConcern: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  catalogOemConcernMake: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    upsert: jest.fn(),
  },
  laborCategory: {
    findFirst: jest.fn(),
  },
  brand: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockTenantContext = {
  getTenantId: jest.fn().mockResolvedValue(tenantId),
};

describe('CatalogProviderSettingsService', () => {
  let service: CatalogProviderSettingsService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockTenantContext.getTenantId.mockResolvedValue(tenantId);
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
        callback(mockPrisma),
    );
    service = new CatalogProviderSettingsService(
      mockPrisma as unknown as PrismaService,
      mockTenantContext as unknown as TenantContextService,
    );
  });

  it('returns seeded defaults and OEM concerns on GET', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      tenant_id: tenantId,
      default_identity_adapter_id: null,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
      default_labor_category_id: null,
      defaultLaborCategory: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: null,
      parts_aftermarket_credentials_secret_ref: 'secret-ref',
      labor_aftermarket_credentials_secret_ref: null,
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    mockPrisma.catalogOemConcern.findMany.mockResolvedValue([
      {
        id: 'concern-stellantis',
        tenant_id: tenantId,
        code: 'STELLANTIS',
        parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_PARTS,
        labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_LABOR,
        parts_credentials_secret_ref: null,
        labor_credentials_secret_ref: null,
        memberMakes: [
          { brand: { id: 10, name: 'Peugeot' } },
          { brand: { id: 11, name: 'Citroën' } },
        ],
      },
    ]);

    const result = await service.getSettings();

    expect(result.awMinutes).toBe(6);
    expect(result.hasPartsAftermarketCredential).toBe(true);
    expect(result.oemConcerns).toHaveLength(1);
    expect(result.oemConcerns[0]).toMatchObject({
      code: 'STELLANTIS',
    });
    expect(result.oemConcerns[0].memberMakes).toEqual([
      { id: 11, name: 'Citroën' },
      { id: 10, name: 'Peugeot' },
    ]);
  });

  it('creates singleton settings with sandbox defaults when missing', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.catalogProviderSettings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'settings-new',
        tenant_id: tenantId,
        default_identity_adapter_id: null,
        default_parts_aftermarket_adapter_id:
          SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
        default_labor_aftermarket_adapter_id:
          SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
        default_labor_category_id: null,
        defaultLaborCategory: null,
        aw_minutes: 6,
        identity_credentials_secret_ref: null,
        parts_aftermarket_credentials_secret_ref: null,
        labor_aftermarket_credentials_secret_ref: null,
        updatedAt: new Date('2026-08-28T00:00:00.000Z'),
      });
    mockPrisma.catalogProviderSettings.create.mockResolvedValue({
      id: 'settings-new',
      tenant_id: tenantId,
      default_identity_adapter_id: null,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
      default_labor_category_id: null,
      defaultLaborCategory: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: null,
      parts_aftermarket_credentials_secret_ref: null,
      labor_aftermarket_credentials_secret_ref: null,
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    mockPrisma.catalogOemConcern.findMany.mockResolvedValue([]);

    await service.getSettings();

    expect(mockPrisma.catalogProviderSettings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: tenantId,
          aw_minutes: 6,
        }),
      }),
    );
  });

  it('rejects default labor category without hourly rate', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.laborCategory.findFirst.mockResolvedValue({
      id: 'cat-1',
      default_hourly_rate: null,
    });

    await expect(
      service.updateSettings({ defaultLaborCategoryId: 'cat-1' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('syncs Stellantis member makes on PATCH', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      tenant_id: tenantId,
      default_identity_adapter_id: null,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
      default_labor_category_id: null,
      defaultLaborCategory: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: null,
      parts_aftermarket_credentials_secret_ref: null,
      labor_aftermarket_credentials_secret_ref: null,
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    mockPrisma.brand.findMany.mockResolvedValue([
      { id: 10, isVehicleMake: true, name: 'Peugeot' },
      { id: 11, isVehicleMake: true, name: 'Citroën' },
    ]);
    mockPrisma.catalogOemConcernMake.findMany.mockResolvedValue([]);
    mockPrisma.catalogOemConcern.findFirst.mockResolvedValue({
      id: 'concern-stellantis',
    });
    mockPrisma.catalogProviderSettings.findFirstOrThrow.mockResolvedValue({
      id: 'settings-1',
      tenant_id: tenantId,
      default_identity_adapter_id: null,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
      default_labor_category_id: null,
      defaultLaborCategory: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: null,
      parts_aftermarket_credentials_secret_ref: null,
      labor_aftermarket_credentials_secret_ref: null,
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    mockPrisma.catalogOemConcern.findMany.mockResolvedValue([
      {
        id: 'concern-stellantis',
        tenant_id: tenantId,
        code: 'STELLANTIS' as CatalogOemConcernCode,
        parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_PARTS,
        labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_LABOR,
        parts_credentials_secret_ref: null,
        labor_credentials_secret_ref: null,
        memberMakes: [
          { brand: { id: 10, name: 'Peugeot' } },
          { brand: { id: 11, name: 'Citroën' } },
        ],
      },
    ]);

    await service.updateSettings({
      oemConcerns: [
        {
          code: 'STELLANTIS',
          memberBrandIds: [10, 11],
        },
      ],
    });

    expect(mockPrisma.catalogOemConcernMake.deleteMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        concern_id: 'concern-stellantis',
        brand_id: { notIn: [10, 11] },
      },
    });
    expect(mockPrisma.catalogOemConcernMake.upsert).toHaveBeenCalledTimes(2);
  });

  it('rejects assigning a make that belongs to another concern', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      tenant_id: tenantId,
      default_identity_adapter_id: null,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
      default_labor_category_id: null,
      defaultLaborCategory: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: null,
      parts_aftermarket_credentials_secret_ref: null,
      labor_aftermarket_credentials_secret_ref: null,
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    mockPrisma.brand.findMany.mockResolvedValue([
      { id: 10, isVehicleMake: true, name: 'BMW' },
    ]);
    mockPrisma.catalogOemConcernMake.findMany.mockResolvedValue([
      {
        brand_id: 10,
        concern: { code: 'BMW' },
        brand: { name: 'BMW' },
      },
    ]);

    await expect(
      service.updateSettings({
        oemConcerns: [{ code: 'STELLANTIS', memberBrandIds: [10] }],
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects the same brand assigned to two concerns in one PATCH payload', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      tenant_id: tenantId,
      default_identity_adapter_id: null,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
      default_labor_category_id: null,
      defaultLaborCategory: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: null,
      parts_aftermarket_credentials_secret_ref: null,
      labor_aftermarket_credentials_secret_ref: null,
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    mockPrisma.brand.findMany.mockResolvedValue([
      { id: 10, isVehicleMake: true, name: 'BMW' },
    ]);
    mockPrisma.catalogOemConcernMake.findMany.mockResolvedValue([]);

    await expect(
      service.updateSettings({
        oemConcerns: [
          { code: 'BMW', memberBrandIds: [10] },
          { code: 'STELLANTIS', memberBrandIds: [10] },
        ],
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(mockPrisma.catalogOemConcernMake.upsert).not.toHaveBeenCalled();
  });

  it('rejects duplicate concern code entries in one PATCH payload', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      tenant_id: tenantId,
      default_identity_adapter_id: null,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
      default_labor_category_id: null,
      defaultLaborCategory: null,
      aw_minutes: 6,
      identity_credentials_secret_ref: null,
      parts_aftermarket_credentials_secret_ref: null,
      labor_aftermarket_credentials_secret_ref: null,
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    mockPrisma.brand.findMany.mockResolvedValue([
      { id: 10, isVehicleMake: true, name: 'Peugeot' },
    ]);
    mockPrisma.catalogOemConcernMake.findMany.mockResolvedValue([]);

    await expect(
      service.updateSettings({
        oemConcerns: [
          { code: 'STELLANTIS', memberBrandIds: [10] },
          { code: 'STELLANTIS', memberBrandIds: [10] },
        ],
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(mockPrisma.catalogOemConcernMake.upsert).not.toHaveBeenCalled();
  });

  it('rejects unknown labor category id', async () => {
    mockPrisma.catalogOemConcern.upsert.mockResolvedValue({});
    mockPrisma.laborCategory.findFirst.mockResolvedValue(null);

    await expect(
      service.updateSettings({
        defaultLaborCategoryId: '00000000-0000-0000-0000-000000000099',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CatalogProviderSettingsController auth', () => {
  it('requires tenant admin access', () => {
    const tenantContext = {
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'TECH' }),
    };
    const controller = new CatalogProviderSettingsController(
      tenantContext as unknown as TenantContextService,
      {} as CatalogProviderSettingsService,
    );

    expect(() => controller.getSettings()).toThrow(ForbiddenException);
  });
});

