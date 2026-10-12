import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard.js';
import { NotificationTaskGuard } from './notification-task.guard.js';
import type { SignedNotificationTaskPayload } from './notification-task.payload.js';
import { NotificationOutboxWorkerService } from './notification-outbox-worker.service.js';

/**
 * Cloud Tasks entry point for one outbox row. Public only at the Nest layer: both guards decide
 * access. The service behind CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL serves it: core-api in v1,
 * which holds the NOTIFICATION_* settings. Never the PDF worker, which holds none of them (ADR-0007).
 */
@Controller('notifications/outbox')
@Public()
@UseGuards(CloudTasksWorkerGuard, NotificationTaskGuard)
export class NotificationOutboxWorkerController {
  constructor(private readonly worker: NotificationOutboxWorkerService) {}

  @Post(':outboxId/worker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async deliver(
    @Param('outboxId') outboxId: string,
    @Body() task: SignedNotificationTaskPayload,
  ): Promise<void> {
    await this.worker.deliver(outboxId, task.tenantId);
  }
}
