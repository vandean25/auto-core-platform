import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/index.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { SiteModule } from '../../site/site.module.js';
import { Autoscout24DmsDeactivationRetryService } from './autoscout24-dms/autoscout24-dms-deactivation-retry.service.js';
import { AUTOSCOUT24_DMS_LISTING_PUBLISHER_PORT } from './autoscout24-dms/autoscout24-dms-api.port.js';
import { FakeAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms/autoscout24-dms-fake.adapter.js';
import { HttpAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms/autoscout24-dms-http.adapter.js';
import { Autoscout24DmsListingPushService } from './autoscout24-dms/autoscout24-dms-listing-push.service.js';
import { NotConfiguredAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms/autoscout24-dms-not-configured.adapter.js';
import { RoutingAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms/autoscout24-dms-routing.adapter.js';
import { Autoscout24DmsPushController } from './autoscout24-dms-push.controller.js';

@Module({
  imports: [PrismaModule, CommonModule, SiteModule],
  controllers: [Autoscout24DmsPushController],
  providers: [
    FakeAutoscout24DmsListingPublisherAdapter,
    NotConfiguredAutoscout24DmsListingPublisherAdapter,
    {
      provide: HttpAutoscout24DmsListingPublisherAdapter,
      useFactory: () => new HttpAutoscout24DmsListingPublisherAdapter(null),
    },
    RoutingAutoscout24DmsListingPublisherAdapter,
    {
      provide: AUTOSCOUT24_DMS_LISTING_PUBLISHER_PORT,
      useExisting: RoutingAutoscout24DmsListingPublisherAdapter,
    },
    Autoscout24DmsListingPushService,
    Autoscout24DmsDeactivationRetryService,
  ],
  exports: [Autoscout24DmsListingPushService],
})
export class Autoscout24DmsModule {}
