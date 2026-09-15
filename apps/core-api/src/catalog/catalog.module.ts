import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogExternalService } from './catalog-external.service.js';
import { CatalogRouterService } from './catalog-router.service.js';
import { CatalogAdapterRegistry } from './catalog-adapter.registry.js';
import {
  PARTS_CATALOG_PROVIDER,
  type PartsCatalogProvider,
} from './providers/parts-catalog.provider.js';
import {
  LABOR_CATALOG_PROVIDER,
  type LaborCatalogProvider,
} from './providers/labor-catalog.provider.js';
import { SandboxOemPartsCatalogProvider } from './providers/sandbox/sandbox-oem-parts.provider.js';
import { SandboxOemLaborCatalogProvider } from './providers/sandbox/sandbox-oem-labor.provider.js';
import { SandboxAftermarketPartsCatalogProvider } from './providers/sandbox/sandbox-aftermarket-parts.provider.js';
import { SandboxAftermarketLaborCatalogProvider } from './providers/sandbox/sandbox-aftermarket-labor.provider.js';
import type { CatalogAssemblyGroupContext } from './providers/catalog-provider.types.js';

class CompositePartsCatalogProvider implements PartsCatalogProvider {
  constructor(
    private readonly oemProvider: SandboxOemPartsCatalogProvider,
    private readonly aftermarketProvider: SandboxAftermarketPartsCatalogProvider,
  ) {}

  search(
    context: Parameters<PartsCatalogProvider['search']>[0],
    adapterId: string,
  ) {
    if (adapterId.includes('aftermarket')) {
      return this.aftermarketProvider.search(context, adapterId);
    }
    return this.oemProvider.search(context, adapterId);
  }

  listAssemblyGroups(context: CatalogAssemblyGroupContext, adapterId: string) {
    if (adapterId.includes('aftermarket')) {
      return this.aftermarketProvider.listAssemblyGroups(context, adapterId);
    }
    return this.oemProvider.listAssemblyGroups(context, adapterId);
  }
}

class CompositeLaborCatalogProvider implements LaborCatalogProvider {
  constructor(
    private readonly oemProvider: SandboxOemLaborCatalogProvider,
    private readonly aftermarketProvider: SandboxAftermarketLaborCatalogProvider,
  ) {}

  search(
    context: Parameters<LaborCatalogProvider['search']>[0],
    adapterId: string,
  ) {
    if (adapterId.includes('aftermarket')) {
      return this.aftermarketProvider.search(context, adapterId);
    }
    return this.oemProvider.search(context, adapterId);
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogExternalService,
    CatalogRouterService,
    CatalogAdapterRegistry,
    SandboxOemPartsCatalogProvider,
    SandboxOemLaborCatalogProvider,
    SandboxAftermarketPartsCatalogProvider,
    SandboxAftermarketLaborCatalogProvider,
    {
      provide: PARTS_CATALOG_PROVIDER,
      useFactory: (
        oem: SandboxOemPartsCatalogProvider,
        aftermarket: SandboxAftermarketPartsCatalogProvider,
      ) => new CompositePartsCatalogProvider(oem, aftermarket),
      inject: [
        SandboxOemPartsCatalogProvider,
        SandboxAftermarketPartsCatalogProvider,
      ],
    },
    {
      provide: LABOR_CATALOG_PROVIDER,
      useFactory: (
        oem: SandboxOemLaborCatalogProvider,
        aftermarket: SandboxAftermarketLaborCatalogProvider,
      ) => new CompositeLaborCatalogProvider(oem, aftermarket),
      inject: [
        SandboxOemLaborCatalogProvider,
        SandboxAftermarketLaborCatalogProvider,
      ],
    },
  ],
})
export class CatalogModule {}
