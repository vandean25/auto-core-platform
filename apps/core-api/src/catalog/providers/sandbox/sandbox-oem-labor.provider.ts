import { Injectable } from '@nestjs/common';
import { CatalogOemConcernCode } from '@prisma/client';
import {
  SANDBOX_CATALOG_ADAPTER_IDS,
  SANDBOX_CATALOG_QUERY,
} from '../../catalog-adapter-ids';
import { CatalogProviderError } from '../catalog-provider.error';
import type {
  CatalogLaborHit,
  CatalogSearchContext,
} from '../catalog-provider.types';
import type { LaborCatalogProvider } from '../labor-catalog.provider';

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
    throw new CatalogProviderError('Sandbox OEM labor provider error');
  }
}

function buildSandboxLaborHits(
  context: CatalogSearchContext,
  adapterId: string,
): CatalogLaborHit[] {
  const query = context.query.trim();
  if (!query || query.includes(SANDBOX_CATALOG_QUERY.EMPTY)) {
    return [];
  }

  assertSandboxBehavior(query);

  const concern = resolveConcernFromAdapterId(adapterId) ?? 'BMW';
  const sourceSystem = concern.toLowerCase();

  return [
    {
      externalId: `${sourceSystem}-labor-1`,
      sourceSystem,
      name: `${concern} OEM ${query}`,
      externalOperationCode: `${sourceSystem.toUpperCase()}-OP-${query.replace(/\s+/g, '-').slice(0, 10)}`,
      standardAw: 12,
      plannedHours: 1.2,
    },
  ];
}

@Injectable()
export class SandboxOemLaborCatalogProvider implements LaborCatalogProvider {
  search(
    context: CatalogSearchContext,
    adapterId: string,
  ): Promise<CatalogLaborHit[]> {
    const allowedIds = [
      SANDBOX_CATALOG_ADAPTER_IDS.OEM_BMW_LABOR,
      SANDBOX_CATALOG_ADAPTER_IDS.OEM_MERCEDES_LABOR,
      SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_LABOR,
    ];
    if (!allowedIds.includes(adapterId as (typeof allowedIds)[number])) {
      throw new CatalogProviderError(
        `Unknown sandbox OEM labor adapter: ${adapterId}`,
      );
    }

    return Promise.resolve(buildSandboxLaborHits(context, adapterId));
  }
}
