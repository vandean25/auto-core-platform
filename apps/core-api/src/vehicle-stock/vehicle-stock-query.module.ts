import { Module } from '@nestjs/common';
import { ScopeContextModule } from '../auth/scope-context/scope-context.module.js';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { VehicleStockQueryService } from './vehicle-stock-query.service.js';
import { GewaehrleistungDueListReadService } from './gewaehrleistung/gewaehrleistung-due-list.read.js';

/** Exposes {@link VehicleStockQueryService} without pulling in the full vehicle-stock module graph. */
@Module({
  imports: [PrismaModule, CommonModule, SiteModule, ScopeContextModule],
  providers: [VehicleStockQueryService, GewaehrleistungDueListReadService],
  exports: [VehicleStockQueryService, GewaehrleistungDueListReadService],
})
export class VehicleStockQueryModule {}
