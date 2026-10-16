import { Logger } from '@nestjs/common';
import type { DomainEventConsumerCloudTasksService } from '../domain-event-consumer/domain-event-consumer-cloud-tasks.service.js';
import { WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER } from '../domain-event-consumer/domain-event-consumer.constants.js';

const logger = new Logger('WakeEstimateDecidedConsumer');

export async function wakeEstimateDecidedConsumerAfterCommit(
  wakeUps: DomainEventConsumerCloudTasksService,
  tenantId: string,
): Promise<void> {
  if (!wakeUps.isEnabled()) {
    return;
  }
  await wakeUps
    .enqueueWakeUp({
      tenantId,
      consumerKey: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
    })
    .catch((cause: unknown) =>
      logger.warn(
        `Could not schedule estimate-decided consumer for tenant ${tenantId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
      ),
    );
}
