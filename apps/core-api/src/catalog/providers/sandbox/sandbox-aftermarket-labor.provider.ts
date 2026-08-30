import { Injectable } from '@nestjs/common';
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

function assertSandboxBehavior(query: string): void {
  if (query.includes(SANDBOX_CATALOG_QUERY.ERROR)) {
    throw new CatalogProviderError('Sandbox aftermarket labor provider error');
  }
}

function buildAftermarketLaborHits(
  context: CatalogSearchContext,
): CatalogLaborHit[] {
  const query = context.query.trim();
  if (!query) {
    return [];
  }

  assertSandboxBehavior(query);

  return [
    {
      externalId: `haynes-${query.replace(/\s+/g, '-').slice(0, 16)}`,
      sourceSystem: 'haynes',
      name: `Aftermarket labor ${query}`,
      externalOperationCode: `HN-${query.replace(/\s+/g, '-').slice(0, 10).toUpperCase()}`,
      standardAw: 8,
      plannedHours: 0.8,
    },
  ];
}

@Injectable()
export class SandboxAftermarketLaborCatalogProvider
  implements LaborCatalogProvider
{
  search(
    context: CatalogSearchContext,
    adapterId: string,
  ): Promise<CatalogLaborHit[]> {
    if (adapterId !== SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR) {
      throw new CatalogProviderError(
        `Unknown sandbox aftermarket labor adapter: ${adapterId}`,
      );
    }

    return Promise.resolve(buildAftermarketLaborHits(context));
  }
}
