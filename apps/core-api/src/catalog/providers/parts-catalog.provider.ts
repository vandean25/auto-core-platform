import type {
  CatalogAssemblyGroupContext,
  CatalogAssemblyGroupNode,
  CatalogPartsHit,
  CatalogSearchContext,
} from './catalog-provider.types';

export const PARTS_CATALOG_PROVIDER = Symbol('PartsCatalogProvider');

export interface PartsCatalogProvider {
  search(
    context: CatalogSearchContext,
    adapterId: string,
  ): Promise<CatalogPartsHit[]>;

  listAssemblyGroups?(
    context: CatalogAssemblyGroupContext,
    adapterId: string,
  ): Promise<CatalogAssemblyGroupNode[]>;
}
