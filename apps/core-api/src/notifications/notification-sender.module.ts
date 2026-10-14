import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BrevoEmailProvider } from './email/brevo-email-provider.js';
import { EmailProviderResolver } from './email/email-provider.resolver.js';
import { FakeEmailProvider } from './email/fake-email-provider.js';
import { SesEmailProvider } from './email/ses-email-provider.js';
import { NotificationOutboxRecoveryService } from './notification-outbox-recovery.service.js';
import { NotificationOutboxRetentionService } from './notification-outbox-retention.service.js';
import { NotificationOutboxWorkerService } from './notification-outbox-worker.service.js';
import { NotificationOutboxWorkerController } from './notification-outbox.worker.controller.js';
import { NotificationTaskGuard } from './notification-task.guard.js';
import { NotificationsModule } from './notifications.module.js';

/**
 * Delivery side of the outbox (AUT-356 phase 2): the Cloud Tasks worker route, the sender, the
 * recovery sweep and body retention. Request handlers never reach it, so nothing is sent inline.
 * The Cloud Tasks service comes from NotificationsModule, so the sender and the request side share one instance.
 */
@Module({
  imports: [PrismaModule, CommonModule, NotificationsModule],
  controllers: [NotificationOutboxWorkerController],
  providers: [
    FakeEmailProvider,
    BrevoEmailProvider,
    SesEmailProvider,
    EmailProviderResolver,
    NotificationOutboxWorkerService,
    NotificationOutboxRecoveryService,
    NotificationOutboxRetentionService,
    NotificationTaskGuard,
  ],
})
export class NotificationSenderModule {}
