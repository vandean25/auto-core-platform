import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BrevoEmailProvider } from './email/brevo-email-provider.js';
import { EmailProviderResolver } from './email/email-provider.resolver.js';
import { FakeEmailProvider } from './email/fake-email-provider.js';
import { SesEmailProvider } from './email/ses-email-provider.js';
import { NotificationOutboxRecoveryService } from './notification-outbox-recovery.service.js';
import { NotificationOutboxReplayController } from './notification-outbox-replay.controller.js';
import { NotificationOutboxReplayService } from './notification-outbox-replay.service.js';
import { NotificationOutboxRetentionService } from './notification-outbox-retention.service.js';
import { NotificationOutboxWorkerService } from './notification-outbox-worker.service.js';
import { NotificationOutboxWorkerController } from './notification-outbox.worker.controller.js';
import { NotificationTaskGuard } from './notification-task.guard.js';
import { NotificationsModule } from './notifications.module.js';
import { PushModule } from '../push/push.module.js';

/**
 * Delivery side of the outbox (AUT-356 phase 2): the Cloud Tasks worker route, the sender, the
 * recovery sweep and body retention. Nothing is sent inline. The admin replay route (phase 6) is the one request
 * handler here: it only moves FAILED rows back to PENDING and queues a wake-up, so the worker still does the send.
 * The Cloud Tasks service comes from NotificationsModule, so the sender and the request side share one instance.
 */
@Module({
  imports: [PrismaModule, CommonModule, NotificationsModule, PushModule],
  controllers: [
    NotificationOutboxWorkerController,
    NotificationOutboxReplayController,
  ],
  providers: [
    FakeEmailProvider,
    BrevoEmailProvider,
    SesEmailProvider,
    EmailProviderResolver,
    NotificationOutboxWorkerService,
    NotificationOutboxRecoveryService,
    NotificationOutboxRetentionService,
    NotificationOutboxReplayService,
    NotificationTaskGuard,
  ],
})
export class NotificationSenderModule {}
