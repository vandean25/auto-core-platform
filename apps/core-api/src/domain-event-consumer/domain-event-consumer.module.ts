import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DomainEventConsumerCloudTasksService } from './domain-event-consumer-cloud-tasks.service.js';
import { DomainEventConsumerTaskGuard } from './domain-event-consumer-task.guard.js';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [
    DomainEventConsumerCloudTasksService,
    DomainEventConsumerTaskGuard,
  ],
  exports: [DomainEventConsumerCloudTasksService, DomainEventConsumerTaskGuard],
})
export class DomainEventConsumerModule {}
