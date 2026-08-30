import { Injectable } from '@nestjs/common';
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

function assertSandboxBehavior(query: string): void {
  if (query.includes(SANDBOX_CATALOG_QUERY.ERROR)) {
    throw new CatalogProviderError('Sandbox aftermarket parts provider error');
  }
}

function buildAftermarketPartsHits(
  context: CatalogSearchContext,
): CatalogPartsHit[] {
  const query = context.query.trim();
  if (!query) {
    return [];
  }

  assertSandboxBehavior(query);

  return [
    {
      externalId: `tecdoc-${query.replace(/\s+/g, '-').slice(0, 16)}`,
      sourceSystem: 'tecdoc',
      name: `Aftermarket ${query}`,
      articleNumber: `TD-${query.replace(/\s+/g, '-').slice(0, 12).toUpperCase()}`,
      brandLabel: 'Bosch',
      unitPrice: 79.99,
      costPriceEst: 52.5,
      ean: '4012345678901',
      unit: 'pcs',
      oemNumbers: [`REF-${query.slice(0, 6).toUpperCase()}`],
    },
  ];
}

@Injectable()
export class SandboxAftermarketPartsCatalogProvider implements PartsCatalogProvider {
  search(
    context: CatalogSearchContext,
    adapterId: string,
  ): Promise<CatalogPartsHit[]> {
    if (adapterId !== SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS) {
      throw new CatalogProviderError(
        `Unknown sandbox aftermarket parts adapter: ${adapterId}`,
      );
    }

    return Promise.resolve(buildAftermarketPartsHits(context));
  }

  listAssemblyGroups(
    _context: CatalogAssemblyGroupContext,
    adapterId: string,
  ): Promise<CatalogAssemblyGroupNode[]> {
    if (adapterId !== SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS) {
      throw new CatalogProviderError(
        `Unknown sandbox aftermarket parts adapter: ${adapterId}`,
      );
    }

    return Promise.resolve([
      {
        id: 'tecdoc-brakes',
        name: 'Braking system',
        children: [
          { id: 'tecdoc-brakes-pads', name: 'Brake pads' },
          { id: 'tecdoc-brakes-discs', name: 'Brake discs' },
        ],
      },
      {
        id: 'tecdoc-filters',
        name: 'Filters',
      },
    ]);
  }
}
