import { Module } from '@nestjs/common';
import { NotificationCloudTasksService } from './notification-cloud-tasks.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';

/**
 * What domain modules import (AUT-356): the outbox writer, and the wake-up enqueue that runs after a commit
 * (ADR-0025 §6). Neither is the delivery side. NotificationSenderModule, which AppModule mounts once, holds the
 * worker route and the sweeps, so they stay out of every domain module's import graph.
 */
@Module({
  providers: [NotificationOutboxService, NotificationCloudTasksService],
  exports: [NotificationOutboxService, NotificationCloudTasksService],
})
export class NotificationsModule {}
