import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { TyreMeasurementController } from './tyre-measurement.controller.js';
import { TyreMeasurementService } from './tyre-measurement.service.js';

@Module({
  imports: [PrismaModule, CommonModule, SiteModule],
  controllers: [TyreMeasurementController],
  providers: [TyreMeasurementService],
})
export class TyreMeasurementModule {}
