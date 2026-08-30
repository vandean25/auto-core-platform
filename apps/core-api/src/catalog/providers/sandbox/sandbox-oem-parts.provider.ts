import { Injectable } from '@nestjs/common';
import { CatalogOemConcernCode } from '@prisma/client';
import {
  SANDBOX_CATALOG_ADAPTER_IDS,
  SANDBOX_CATALOG_QUERY,
} from '../../catalog-adapter-ids';
import { CatalogProviderError } from '../catalog-provider.error';
import type {
  CatalogAssemblyGroupContext,
  CatalogAssemblyGroupNode,
  CatalogPartsHit,
  CatalogSearchContext,
} from '../catalog-provider.types';
import type { PartsCatalogProvider } from '../parts-catalog.provider';

function resolveConcernFromAdapterId(
  adapterId: string,
): CatalogOemConcernCode | null {
  if (adapterId.includes('bmw')) {
    return 'BMW';
  }
  if (adapterId.includes('mercedes')) {
    return 'MERCEDES';
  }
  if (adapterId.includes('stellantis')) {
    return 'STELLANTIS';
  }
  return null;
}

function assertSandboxBehavior(query: string): void {
  if (query.includes(SANDBOX_CATALOG_QUERY.ERROR)) {
    throw new CatalogProviderError('Sandbox OEM parts provider error');
  }
}

function buildSandboxPartsHits(
  context: CatalogSearchContext,
  adapterId: string,
): CatalogPartsHit[] {
  const query = context.query.trim();
  if (!query || query.includes(SANDBOX_CATALOG_QUERY.EMPTY)) {
    return [];
  }

  assertSandboxBehavior(query);

  const concern = resolveConcernFromAdapterId(adapterId) ?? 'BMW';
  const sourceSystem = concern.toLowerCase();

  return [
    {
      externalId: `${sourceSystem}-part-1`,
      sourceSystem,
      name: `${concern} OEM ${query}`,
      articleNumber: `${sourceSystem.toUpperCase()}-${query.replace(/\s+/g, '-').slice(0, 12)}`,
      brandLabel: concern,
      unitPrice: 129.9,
      costPriceEst: 89.5,
      unit: 'pcs',
      oemNumbers: [`OEM-${query.slice(0, 8).toUpperCase()}`],
    },
    {
      externalId: `${sourceSystem}-part-2`,
      sourceSystem,
      name: `${concern} OEM filter kit`,
      articleNumber: `${sourceSystem.toUpperCase()}-FILTER`,
      brandLabel: concern,
      unitPrice: 45.0,
      costPriceEst: null,
      unit: 'pcs',
    },
  ];
}

@Injectable()
export class SandboxOemPartsCatalogProvider implements PartsCatalogProvider {
  search(
    context: CatalogSearchContext,
    adapterId: string,
  ): Promise<CatalogPartsHit[]> {
    const allowedIds = [
      SANDBOX_CATALOG_ADAPTER_IDS.OEM_BMW_PARTS,
      SANDBOX_CATALOG_ADAPTER_IDS.OEM_MERCEDES_PARTS,
      SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_PARTS,
    ];
    if (!allowedIds.includes(adapterId as (typeof allowedIds)[number])) {
      throw new CatalogProviderError(
        `Unknown sandbox OEM parts adapter: ${adapterId}`,
      );
    }

    return Promise.resolve(buildSandboxPartsHits(context, adapterId));
  }

  listAssemblyGroups(
    context: CatalogAssemblyGroupContext,
    adapterId: string,
  ): Promise<CatalogAssemblyGroupNode[]> {
    const concern = resolveConcernFromAdapterId(adapterId) ?? 'BMW';
    return Promise.resolve([
      {
        id: `${concern.toLowerCase()}-engine`,
        name: 'Engine',
        children: [
          { id: `${concern.toLowerCase()}-engine-oil`, name: 'Oil system' },
          { id: `${concern.toLowerCase()}-engine-cooling`, name: 'Cooling' },
        ],
      },
      {
        id: `${concern.toLowerCase()}-brakes`,
        name: 'Brakes',
      },
    ]);
  }
}
