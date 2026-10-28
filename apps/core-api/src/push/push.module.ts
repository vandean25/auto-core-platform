import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PushDeliveryService } from './push-delivery.service.js';
import { PushDeviceCleanupService } from './push-device-cleanup.service.js';
import {
  FirebasePushMessagingGateway,
  PushMessagingGateway,
} from './push-messaging.gateway.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

/**
 * Web push for staff (ADR-0033): the `/me/push` API, the cleanup job and the sender the outbox worker calls.
 * NotificationSenderModule imports this module for `PushDeliveryService`.
 */
@Module({
  imports: [PrismaModule, CommonModule, NotificationsModule],
  controllers: [PushController],
  providers: [
    PushService,
    PushDeliveryService,
    PushDeviceCleanupService,
    { provide: PushMessagingGateway, useClass: FirebasePushMessagingGateway },
  ],
  exports: [PushDeliveryService, PushDeviceCleanupService],
})
export class PushModule {}
