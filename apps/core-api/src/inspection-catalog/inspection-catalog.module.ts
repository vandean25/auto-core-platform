import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { InspectionCatalogController } from './inspection-catalog.controller.js';
import { InspectionCatalogService } from './inspection-catalog.service.js';

@Module({
  imports: [PrismaModule, SiteModule],
  controllers: [InspectionCatalogController],
  providers: [InspectionCatalogService],
  exports: [InspectionCatalogService],
})
export class InspectionCatalogModule {}
