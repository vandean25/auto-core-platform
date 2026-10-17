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
import { DomainEventConsumerTaskGuard } from '../domain-event-consumer/domain-event-consumer-task.guard.js';
import type { SignedDomainEventConsumerTaskPayload } from '../domain-event-consumer/domain-event-consumer-task.payload.js';
import { WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER } from '../domain-event-consumer/domain-event-consumer.constants.js';
import { WorkshopEstimateDecidedConsumerService } from './workshop-estimate-decided-consumer.service.js';

@Controller('domain-event-consumers')
@Public()
@UseGuards(CloudTasksWorkerGuard, DomainEventConsumerTaskGuard)
export class WorkshopEstimateDecidedConsumerWorkerController {
  constructor(
    private readonly consumer: WorkshopEstimateDecidedConsumerService,
  ) {}

  @Post(':consumerKey/worker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async run(
    @Param('consumerKey') consumerKey: string,
    @Body() _task: SignedDomainEventConsumerTaskPayload,
  ): Promise<void> {
    const decoded = decodeURIComponent(consumerKey);
    if (decoded !== WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER) {
      return;
    }
    await this.consumer.processTenantBatch(_task.tenantId, new Date());
  }
}
