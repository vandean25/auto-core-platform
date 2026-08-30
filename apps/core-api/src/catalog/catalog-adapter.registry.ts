import { Inject, Injectable } from '@nestjs/common';
import {
  PARTS_CATALOG_PROVIDER,
  type PartsCatalogProvider,
} from './providers/parts-catalog.provider';
import {
  LABOR_CATALOG_PROVIDER,
  type LaborCatalogProvider,
} from './providers/labor-catalog.provider';

@Injectable()
export class CatalogAdapterRegistry {
  constructor(
    @Inject(PARTS_CATALOG_PROVIDER)
    private readonly partsProvider: PartsCatalogProvider,
    @Inject(LABOR_CATALOG_PROVIDER)
    private readonly laborProvider: LaborCatalogProvider,
  ) {}

  getPartsProvider(): PartsCatalogProvider {
    return this.partsProvider;
  }

  getLaborProvider(): LaborCatalogProvider {
    return this.laborProvider;
  }
}
