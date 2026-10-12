import { Module } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service.js';

/**
 * The outbox writer that domain modules import (AUT-356). It exports only `NotificationOutboxService`.
 * The delivery side is NotificationSenderModule, which AppModule mounts once, so the worker route and the
 * sweeps stay out of every domain module's import graph.
 */
@Module({
  providers: [NotificationOutboxService],
  exports: [NotificationOutboxService],
})
export class NotificationsModule {}
