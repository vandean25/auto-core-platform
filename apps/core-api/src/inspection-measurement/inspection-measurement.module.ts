import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { FakeBrakeMeasurementReadAdapter } from './inspection-measurement-fake.adapter.js';
import { NotConfiguredBrakeMeasurementReadAdapter } from './inspection-measurement-not-configured.adapter.js';
import { RoutingBrakeMeasurementReadAdapter } from './inspection-measurement-routing.adapter.js';
import { InspectionMeasurementController } from './inspection-measurement.controller.js';
import { InspectionMeasurementService } from './inspection-measurement.service.js';
import { BRAKE_MEASUREMENT_READ_PORT } from './inspection-measurement.port.js';

@Module({
  imports: [PrismaModule, SiteModule],
  controllers: [InspectionMeasurementController],
  providers: [
    InspectionMeasurementService,
    FakeBrakeMeasurementReadAdapter,
    NotConfiguredBrakeMeasurementReadAdapter,
    RoutingBrakeMeasurementReadAdapter,
    {
      provide: BRAKE_MEASUREMENT_READ_PORT,
      useExisting: RoutingBrakeMeasurementReadAdapter,
    },
  ],
  exports: [InspectionMeasurementService],
})
export class InspectionMeasurementModule {}
