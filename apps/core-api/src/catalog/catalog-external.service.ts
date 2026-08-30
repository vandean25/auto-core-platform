import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { resolveOemConcernForBrand } from '../prisma/seed-vehicle-catalog-providers';
import { createIdentityInputFingerprint } from '../vehicle/vehicle-identity.util';
import { signCatalogHitPayload } from './catalog-hit-payload';
import { CatalogRouterService } from './catalog-router.service';
import type {
  CatalogAssemblyGroupNode,
  CatalogLaborHit,
  CatalogPartsHit,
  CatalogSearchConcern,
  CatalogSearchContext,
  CatalogSearchSource,
} from './providers/catalog-provider.types';

type VehicleIdentitySnapshot = {
  id: string;
  vin: string | null;
  plate: string | null;
  make_brand_id: number | null;
  identity_keys: Prisma.JsonValue;
  identity_input_fingerprint: string | null;
};

@Injectable()
export class CatalogExternalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(CatalogRouterService)
    private readonly router: CatalogRouterService,
  ) {}

  async search(params: {
    workshopOrderId: string;
    concern: CatalogSearchConcern;
    q?: string;
    source?: CatalogSearchSource;
    confirmFallback?: boolean;
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const workshopOrderId = params.workshopOrderId.trim();
    const concern = params.concern;
    const source = params.source ?? 'AUTO';
    const confirmFallback = params.confirmFallback ?? false;
    const query = params.q?.trim() ?? '';

    if (!workshopOrderId) {
      throw new BadRequestException('workshopOrderId is required');
    }

    const { vehicle, settings, oemConcern, context } =
      await this.loadSearchContext({
        tenantId,
        workshopOrderId,
        query,
      });

    this.assertIdentityFresh(vehicle);

    const result = await this.router.search({
      context,
      concern,
      source,
      confirmFallback,
      settings,
      oemConcern,
    });

    return {
      ...result,
      items: this.attachHitTokens({
        tenantId,
        workshopOrderId,
        vehicleId: vehicle.id,
        concern,
        items: result.items,
      }),
    };
  }

  async listAssemblyGroups(params: {
    workshopOrderId: string;
    concern: CatalogSearchConcern;
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const workshopOrderId = params.workshopOrderId.trim();

    if (!workshopOrderId) {
      throw new BadRequestException('workshopOrderId is required');
    }

    if (params.concern !== 'PARTS') {
      throw new BadRequestException('concern must be PARTS');
    }

    const { vehicle, settings, oemConcern, context } =
      await this.loadSearchContext({
        tenantId,
        workshopOrderId,
        query: '',
      });

    this.assertIdentityFresh(vehicle);

    const groups = await this.router.listAssemblyGroups({
      context,
      settings,
      oemConcern,
    });

    return { groups };
  }

  private async loadSearchContext(params: {
    tenantId: string;
    workshopOrderId: string;
    query: string;
  }) {
    const workshopOrder = await this.prisma.workshopOrder.findFirst({
      where: {
        id: params.workshopOrderId,
        tenant_id: params.tenantId,
      },
      select: {
        id: true,
        vehicle: {
          select: {
            id: true,
            vin: true,
            plate: true,
            make_brand_id: true,
            identity_keys: true,
            identity_input_fingerprint: true,
            makeBrand: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!workshopOrder?.vehicle) {
      throw new NotFoundException(
        `Workshop order ${params.workshopOrderId} was not found`,
      );
    }

    const vehicle = workshopOrder.vehicle;
    const settingsRow = await this.prisma.catalogProviderSettings.findFirst({
      where: { tenant_id: params.tenantId },
      select: {
        default_parts_aftermarket_adapter_id: true,
        default_labor_aftermarket_adapter_id: true,
      },
    });

    const oemConcernRow = vehicle.make_brand_id
      ? await resolveOemConcernForBrand(
          this.prisma,
          params.tenantId,
          vehicle.make_brand_id,
        )
      : null;

    const settings = {
      defaultPartsAftermarketAdapterId:
        settingsRow?.default_parts_aftermarket_adapter_id ?? null,
      defaultLaborAftermarketAdapterId:
        settingsRow?.default_labor_aftermarket_adapter_id ?? null,
    };

    const oemConcern = oemConcernRow
      ? {
          partsAdapterId: oemConcernRow.concern.parts_adapter_id,
          laborAdapterId: oemConcernRow.concern.labor_adapter_id,
        }
      : null;

    const context: CatalogSearchContext = {
      tenantId: params.tenantId,
      workshopOrderId: params.workshopOrderId,
      vehicleId: vehicle.id,
      makeBrandId: vehicle.make_brand_id ?? 0,
      identityKeys: vehicle.identity_keys,
      oemConcernCode: oemConcernRow?.concern.code ?? null,
      query: params.query,
    };

    return {
      vehicle,
      settings,
      oemConcern,
      context,
    };
  }

  private assertIdentityFresh(vehicle: VehicleIdentitySnapshot): void {
    if (vehicle.make_brand_id == null) {
      throw new ConflictException(
        'Vehicle identity is stale; resolve identity before external catalog search',
      );
    }

    if (!vehicle.identity_input_fingerprint) {
      throw new ConflictException(
        'Vehicle identity is stale; resolve identity before external catalog search',
      );
    }

    const currentFingerprint = createIdentityInputFingerprint(
      vehicle.vin,
      vehicle.plate,
    );
    if (vehicle.identity_input_fingerprint !== currentFingerprint) {
      throw new ConflictException(
        'Vehicle identity is stale; resolve identity before external catalog search',
      );
    }
  }

  private attachHitTokens(params: {
    tenantId: string;
    workshopOrderId: string;
    vehicleId: string;
    concern: CatalogSearchConcern;
    items: CatalogPartsHit[] | CatalogLaborHit[];
  }): Array<(CatalogPartsHit | CatalogLaborHit) & { hitToken: string }> {
    const results: Array<
      (CatalogPartsHit | CatalogLaborHit) & { hitToken: string }
    > = [];

    for (const item of params.items) {
      const hitToken = this.createHitToken({
        tenantId: params.tenantId,
        workshopOrderId: params.workshopOrderId,
        vehicleId: params.vehicleId,
        concern: params.concern,
        item,
      });
      results.push({ ...item, hitToken });
    }

    return results;
  }

  private createHitToken(params: {
    tenantId: string;
    workshopOrderId: string;
    vehicleId: string;
    concern: CatalogSearchConcern;
    item: CatalogPartsHit | CatalogLaborHit;
  }): string {
    if (params.concern === 'PARTS' && 'articleNumber' in params.item) {
      const part = params.item;
      return signCatalogHitPayload({
        tenantId: params.tenantId,
        workshopOrderId: params.workshopOrderId,
        vehicleId: params.vehicleId,
        concern: 'PARTS',
        sourceSystem: part.sourceSystem,
        externalId: part.externalId,
        name: part.name,
        articleNumber: part.articleNumber,
        unitPrice: part.unitPrice,
        brandLabel: part.brandLabel,
        ean: part.ean ?? null,
        unit: part.unit ?? null,
        fitmentNotes: part.fitmentNotes ?? null,
        costPriceEst: part.costPriceEst ?? null,
        oemNumbers: part.oemNumbers,
      });
    }

    if ('externalOperationCode' in params.item) {
      const labor = params.item;
      return signCatalogHitPayload({
        tenantId: params.tenantId,
        workshopOrderId: params.workshopOrderId,
        vehicleId: params.vehicleId,
        concern: 'LABOR',
        sourceSystem: labor.sourceSystem,
        externalId: labor.externalId,
        name: labor.name,
        externalOperationCode: labor.externalOperationCode,
        standardAw: labor.standardAw ?? null,
        plannedHours: labor.plannedHours ?? null,
      });
    }

    throw new Error('Unsupported catalog hit item shape');
  }
}

export type CatalogExternalAssemblyGroupsResponse = {
  groups: CatalogAssemblyGroupNode[];
};
