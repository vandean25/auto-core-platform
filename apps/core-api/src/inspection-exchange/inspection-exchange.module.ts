import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { InspectionExchangeController } from './inspection-exchange.controller.js';
import { InspectionExchangeService } from './inspection-exchange.service.js';
import { FakeEbvDmsResultReadAdapter } from './inspection-exchange-fake.adapter.js';
import { NotConfiguredEbvDmsResultReadAdapter } from './inspection-exchange-not-configured.adapter.js';
import { RoutingEbvDmsResultReadAdapter } from './inspection-exchange-routing.adapter.js';
import { EBV_DMS_RESULT_READ_PORT } from './inspection-exchange.port.js';

@Module({
  imports: [PrismaModule, SiteModule],
  controllers: [InspectionExchangeController],
  providers: [
    InspectionExchangeService,
    FakeEbvDmsResultReadAdapter,
    NotConfiguredEbvDmsResultReadAdapter,
    RoutingEbvDmsResultReadAdapter,
    {
      provide: EBV_DMS_RESULT_READ_PORT,
      useExisting: RoutingEbvDmsResultReadAdapter,
    },
  ],
  exports: [InspectionExchangeService],
})
export class InspectionExchangeModule {}
