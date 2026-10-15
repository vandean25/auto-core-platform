import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DomainEventFeedAuthorization } from './domain-event-feed.authorization.js';
import { DomainEventFeedController } from './domain-event-feed.controller.js';
import { DomainEventFeedService } from './domain-event-feed.service.js';
import { DomainEventStoreService } from './domain-event-store.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [DomainEventFeedController],
  providers: [
    DomainEventStoreService,
    DomainEventFeedService,
    DomainEventFeedAuthorization,
  ],
  exports: [DomainEventStoreService, DomainEventFeedService],
})
export class DomainEventStoreModule {}
