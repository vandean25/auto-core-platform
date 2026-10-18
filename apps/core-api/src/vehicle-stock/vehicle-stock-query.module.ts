import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { VehicleStockQueryService } from './vehicle-stock-query.service.js';

/** Exposes {@link VehicleStockQueryService} without pulling in the full vehicle-stock module graph. */
@Module({
  imports: [PrismaModule, CommonModule, SiteModule],
  providers: [VehicleStockQueryService],
  exports: [VehicleStockQueryService],
})
export class VehicleStockQueryModule {}
