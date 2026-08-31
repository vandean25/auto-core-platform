import type {
  CatalogLaborHit,
  CatalogSearchContext,
} from './catalog-provider.types';

export const LABOR_CATALOG_PROVIDER = Symbol('LaborCatalogProvider');

export interface LaborCatalogProvider {
  search(
    context: CatalogSearchContext,
    adapterId: string,
  ): Promise<CatalogLaborHit[]>;
}
