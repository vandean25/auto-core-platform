import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CatalogOemConcernCode,
  Prisma,
  type CatalogOemConcern,
  type CatalogProviderSettings,
  type LaborCategory,
} from '@prisma/client';
import { SANDBOX_CATALOG_ADAPTER_IDS } from '../catalog/catalog-adapter-ids';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CatalogProviderDefaultLaborCategoryDto,
  CatalogProviderOemConcernResponseDto,
  CatalogProviderSettingsResponseDto,
  UpdateCatalogProviderSettingsDto,
} from './dto/catalog-provider-settings.dto';

const OEM_CONCERN_CODES: CatalogOemConcernCode[] = [
  'BMW',
  'MERCEDES',
  'STELLANTIS',
];

const CONCERN_ADAPTER_IDS: Record<
  CatalogOemConcernCode,
  { parts_adapter_id: string; labor_adapter_id: string }
> = {
  BMW: {
    parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_BMW_PARTS,
    labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_BMW_LABOR,
  },
  MERCEDES: {
    parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_MERCEDES_PARTS,
    labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_MERCEDES_LABOR,
  },
  STELLANTIS: {
    parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_PARTS,
    labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_LABOR,
  },
};

type SettingsWithRelations = CatalogProviderSettings & {
  defaultLaborCategory: LaborCategory | null;
};

type ConcernWithMakes = CatalogOemConcern & {
  memberMakes: Array<{
    brand: {
      id: number;
      name: string;
    };
  }>;
};

function toHourlyRate(value: Prisma.Decimal | null | undefined): number | null {
  return value !== null && value !== undefined ? Number(value) : null;
}

@Injectable()
export class CatalogProviderSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getSettings(): Promise<CatalogProviderSettingsResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.ensureOemConcerns(tenantId);
    const settings = await this.getOrCreateSettings(tenantId);
    const concerns = await this.loadOemConcerns(tenantId);
    return this.toResponse(settings, concerns);
  }

  async updateSettings(
    dto: UpdateCatalogProviderSettingsDto,
  ): Promise<CatalogProviderSettingsResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.ensureOemConcerns(tenantId);

    if (dto.defaultLaborCategoryId !== undefined) {
      await this.assertValidDefaultLaborCategory(
        tenantId,
        dto.defaultLaborCategoryId,
      );
    }

    if (dto.oemConcerns !== undefined) {
      await this.assertValidOemConcernUpdates(tenantId, dto.oemConcerns);
    }

    const existing = await this.getOrCreateSettings(tenantId);

    await this.prisma.$transaction(async (tx) => {
      await tx.catalogProviderSettings.update({
        where: { id: existing.id },
        data: {
          ...(dto.defaultIdentityAdapterId !== undefined && {
            default_identity_adapter_id: dto.defaultIdentityAdapterId,
          }),
          ...(dto.defaultPartsAftermarketAdapterId !== undefined && {
            default_parts_aftermarket_adapter_id:
              dto.defaultPartsAftermarketAdapterId,
          }),
          ...(dto.defaultLaborAftermarketAdapterId !== undefined && {
            default_labor_aftermarket_adapter_id:
              dto.defaultLaborAftermarketAdapterId,
          }),
          ...(dto.defaultLaborCategoryId !== undefined && {
            default_labor_category_id: dto.defaultLaborCategoryId,
          }),
          ...(dto.awMinutes !== undefined && { aw_minutes: dto.awMinutes }),
        },
      });

      if (dto.oemConcerns !== undefined) {
        for (const concernUpdate of dto.oemConcerns) {
          await this.syncConcernMemberMakes(tx, tenantId, concernUpdate);
        }
      }
    });

    const updated = await this.prisma.catalogProviderSettings.findFirstOrThrow({
      where: { id: existing.id, tenant_id: tenantId },
      include: { defaultLaborCategory: true },
    });
    const concerns = await this.loadOemConcerns(tenantId);
    return this.toResponse(updated, concerns);
  }

  private async getOrCreateSettings(
    tenantId: string,
  ): Promise<SettingsWithRelations> {
    const existing = await this.prisma.catalogProviderSettings.findFirst({
      where: { tenant_id: tenantId },
      include: { defaultLaborCategory: true },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.catalogProviderSettings.create({
      data: {
        tenant_id: tenantId,
        default_parts_aftermarket_adapter_id:
          SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
        default_labor_aftermarket_adapter_id:
          SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
        aw_minutes: 6,
      },
      include: { defaultLaborCategory: true },
    });
  }

  private async ensureOemConcerns(tenantId: string): Promise<void> {
    for (const code of OEM_CONCERN_CODES) {
      await this.prisma.catalogOemConcern.upsert({
        where: {
          tenant_id_code: {
            tenant_id: tenantId,
            code,
          },
        },
        update: {},
        create: {
          tenant_id: tenantId,
          code,
          ...CONCERN_ADAPTER_IDS[code],
        },
      });
    }
  }

  private async loadOemConcerns(tenantId: string): Promise<ConcernWithMakes[]> {
    return this.prisma.catalogOemConcern.findMany({
      where: {
        tenant_id: tenantId,
        code: { in: OEM_CONCERN_CODES },
      },
      include: {
        memberMakes: {
          include: {
            brand: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    });
  }

  private async assertValidDefaultLaborCategory(
    tenantId: string,
    laborCategoryId: string | null,
  ): Promise<void> {
    if (laborCategoryId === null) {
      return;
    }

    const category = await this.prisma.laborCategory.findFirst({
      where: { id: laborCategoryId, tenant_id: tenantId },
      select: { id: true, default_hourly_rate: true },
    });

    if (!category) {
      throw new BadRequestException(
        `Labor category with ID "${laborCategoryId}" not found.`,
      );
    }

    if (category.default_hourly_rate === null) {
      throw new UnprocessableEntityException(
        'Default labor category must have a non-null default hourly rate.',
      );
    }
  }

  private async assertValidOemConcernUpdates(
    tenantId: string,
    updates: NonNullable<UpdateCatalogProviderSettingsDto['oemConcerns']>,
  ): Promise<void> {
    const allBrandIds = [
      ...new Set(updates.flatMap((update) => update.memberBrandIds)),
    ];

    if (allBrandIds.length === 0) {
      return;
    }

    const brands = await this.prisma.brand.findMany({
      where: {
        tenant_id: tenantId,
        id: { in: allBrandIds },
      },
      select: { id: true, isVehicleMake: true, name: true },
    });

    const brandById = new Map(brands.map((brand) => [brand.id, brand]));

    for (const brandId of allBrandIds) {
      const brand = brandById.get(brandId);
      if (!brand) {
        throw new BadRequestException(
          `Vehicle-make brand with ID "${brandId}" not found.`,
        );
      }
      if (!brand.isVehicleMake) {
        throw new UnprocessableEntityException(
          `Brand "${brand.name}" is not configured as a vehicle make.`,
        );
      }
    }

    const existingAssignments =
      await this.prisma.catalogOemConcernMake.findMany({
        where: {
          tenant_id: tenantId,
          brand_id: { in: allBrandIds },
        },
        include: {
          concern: { select: { code: true } },
          brand: { select: { name: true } },
        },
      });

    for (const update of updates) {
      for (const brandId of update.memberBrandIds) {
        const assignment = existingAssignments.find(
          (row) => row.brand_id === brandId,
        );
        if (assignment && assignment.concern.code !== update.code) {
          const brand = brandById.get(brandId);
          throw new UnprocessableEntityException(
            `Brand "${brand?.name ?? brandId}" is already assigned to ${assignment.concern.code}.`,
          );
        }
      }
    }
  }

  private async syncConcernMemberMakes(
    tx: Prisma.TransactionClient,
    tenantId: string,
    update: NonNullable<
      UpdateCatalogProviderSettingsDto['oemConcerns']
    >[number],
  ): Promise<void> {
    const concern = await tx.catalogOemConcern.findFirst({
      where: { tenant_id: tenantId, code: update.code },
      select: { id: true },
    });

    if (!concern) {
      throw new BadRequestException(
        `OEM concern "${update.code}" is not configured for this tenant.`,
      );
    }

    const desiredBrandIds = [...new Set(update.memberBrandIds)];

    await tx.catalogOemConcernMake.deleteMany({
      where: {
        tenant_id: tenantId,
        concern_id: concern.id,
        ...(desiredBrandIds.length > 0
          ? { brand_id: { notIn: desiredBrandIds } }
          : {}),
      },
    });

    for (const brandId of desiredBrandIds) {
      await tx.catalogOemConcernMake.upsert({
        where: {
          tenant_id_brand_id: {
            tenant_id: tenantId,
            brand_id: brandId,
          },
        },
        update: { concern_id: concern.id },
        create: {
          tenant_id: tenantId,
          concern_id: concern.id,
          brand_id: brandId,
        },
      });
    }
  }

  private toResponse(
    settings: SettingsWithRelations,
    concerns: ConcernWithMakes[],
  ): CatalogProviderSettingsResponseDto {
    const defaultLaborCategory = this.mapDefaultLaborCategory(
      settings.defaultLaborCategory,
    );

    return {
      id: settings.id,
      defaultIdentityAdapterId: settings.default_identity_adapter_id,
      defaultPartsAftermarketAdapterId:
        settings.default_parts_aftermarket_adapter_id,
      defaultLaborAftermarketAdapterId:
        settings.default_labor_aftermarket_adapter_id,
      defaultLaborCategoryId: settings.default_labor_category_id,
      defaultLaborCategory,
      awMinutes: settings.aw_minutes,
      hasIdentityCredential: Boolean(settings.identity_credentials_secret_ref),
      hasPartsAftermarketCredential: Boolean(
        settings.parts_aftermarket_credentials_secret_ref,
      ),
      hasLaborAftermarketCredential: Boolean(
        settings.labor_aftermarket_credentials_secret_ref,
      ),
      oemConcerns: concerns.map((concern) => this.mapOemConcern(concern)),
      updatedAt: settings.updatedAt,
    };
  }

  private mapDefaultLaborCategory(
    category: LaborCategory | null,
  ): CatalogProviderDefaultLaborCategoryDto | null {
    if (!category) {
      return null;
    }

    return {
      id: category.id,
      name: category.name,
      defaultHourlyRate: toHourlyRate(category.default_hourly_rate),
    };
  }

  private mapOemConcern(
    concern: ConcernWithMakes,
  ): CatalogProviderOemConcernResponseDto {
    return {
      code: concern.code,
      partsAdapterId: concern.parts_adapter_id,
      laborAdapterId: concern.labor_adapter_id,
      hasPartsCredential: Boolean(concern.parts_credentials_secret_ref),
      hasLaborCredential: Boolean(concern.labor_credentials_secret_ref),
      memberMakes: concern.memberMakes
        .map((memberMake) => ({
          id: memberMake.brand.id,
          name: memberMake.brand.name,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }
}
