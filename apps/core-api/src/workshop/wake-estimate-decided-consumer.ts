import { Logger } from '@nestjs/common';
import type { DomainEventConsumerCloudTasksService } from '../domain-event-consumer/domain-event-consumer-cloud-tasks.service.js';
import { WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER } from '../domain-event-consumer/domain-event-consumer.constants.js';
import type { WorkshopEstimateDecidedConsumerService } from './workshop-estimate-decided-consumer.service.js';

const logger = new Logger('WakeEstimateDecidedConsumer');

function logConsumerBatchFailure(tenantId: string, cause: unknown): void {
  logger.warn(
    `Estimate-decided consumer batch failed for tenant ${tenantId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
  );
}

/** Best-effort notice delivery after the decision transaction commits; never fails the caller. */
export async function runEstimateDecidedConsumerAfterCommit(
  consumer: WorkshopEstimateDecidedConsumerService,
  wakeUps: DomainEventConsumerCloudTasksService,
  tenantId: string,
  now?: Date,
): Promise<void> {
  await consumer
    .processTenantBatch(tenantId, now ?? new Date())
    .catch((cause: unknown) => logConsumerBatchFailure(tenantId, cause));
  await wakeEstimateDecidedConsumerAfterCommit(wakeUps, tenantId);
}

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
