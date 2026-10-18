import { Injectable, Logger } from '@nestjs/common';
import { WorkshopTaskStatus, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DOMAIN_EVENT_TYPES } from '../domain-event-store/domain-event.constants.js';
import {
  DOMAIN_EVENT_CONSUMER_BATCH_SIZE,
  DOMAIN_EVENT_CONSUMER_LEASE_MS,
  DOMAIN_EVENT_CONSUMER_OUTCOME,
  WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
} from '../domain-event-consumer/domain-event-consumer.constants.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  decideEstimateDecidedConsumerOutcome,
  type EstimateDecidedDomainContext,
} from './workshop-estimate-decided-consumer.logic.js';

@Injectable()
export class WorkshopEstimateDecidedConsumerService {
  private readonly logger = new Logger(
    WorkshopEstimateDecidedConsumerService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: NotificationOutboxService,
    private readonly requestContext: RequestContextService,
  ) {}

  get consumerKey(): string {
    return WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER;
  }

  async processTenantBatch(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<number> {
    return this.requestContext.runAsWorker(
      tenantId,
      () => this.processTenantBatchInner(tenantId, now),
      { workerId: 'workshop-estimate-decided-consumer' },
    );
  }

  private async processTenantBatchInner(
    tenantId: string,
    now: Date,
  ): Promise<number> {
    const claimToken = randomUUID();
    const claimExpiresAt = new Date(
      now.getTime() + DOMAIN_EVENT_CONSUMER_LEASE_MS,
    );
    const claimed = await this.tryClaimProgress(
      tenantId,
      claimToken,
      claimExpiresAt,
      now,
    );
    if (!claimed) {
      return 0;
    }

    let processed = 0;
    try {
      const progress = await this.prisma.domainEventConsumerProgress.findFirst({
        where: {
          tenant_id: tenantId,
          consumer_key: this.consumerKey,
        },
      });
      if (!progress) {
        return 0;
      }
      const events = await this.prisma.domainEvent.findMany({
        where: {
          tenant_id: tenantId,
          event_type: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
          sequence: { gt: progress.cursor_sequence },
        },
        orderBy: { sequence: 'asc' },
        take: DOMAIN_EVENT_CONSUMER_BATCH_SIZE,
        select: {
          id: true,
          sequence: true,
          event_type: true,
          payload: true,
        },
      });
      for (const event of events) {
        await this.processOneEvent(tenantId, event.id, now, claimToken);
        processed += 1;
      }
    } finally {
      await this.releaseClaim(tenantId, claimToken);
    }
    return processed;
  }

  private async tryClaimProgress(
    tenantId: string,
    claimToken: string,
    claimExpiresAt: Date,
    now: Date,
  ): Promise<boolean> {
    await this.prisma.domainEventConsumerProgress.upsert({
      where: {
        tenant_id_consumer_key: {
          tenant_id: tenantId,
          consumer_key: this.consumerKey,
        },
      },
      create: {
        tenant_id: tenantId,
        consumer_key: this.consumerKey,
        cursor_sequence: BigInt(0),
      },
      update: {},
    });
    const claimed = await this.prisma.domainEventConsumerProgress.updateMany({
      where: {
        tenant_id: tenantId,
        consumer_key: this.consumerKey,
        OR: [{ claim_token: null }, { claim_expires_at: { lt: now } }],
      },
      data: {
        claim_token: claimToken,
        claim_expires_at: claimExpiresAt,
      },
    });
    return claimed.count === 1;
  }

  private async releaseClaim(
    tenantId: string,
    claimToken: string,
  ): Promise<void> {
    await this.prisma.domainEventConsumerProgress.updateMany({
      where: {
        tenant_id: tenantId,
        consumer_key: this.consumerKey,
        claim_token: claimToken,
      },
      data: {
        claim_token: null,
        claim_expires_at: null,
      },
    });
  }

  private async processOneEvent(
    tenantId: string,
    eventId: string,
    now: Date,
    claimToken: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.domainEventConsumerDelivery.findFirst({
        where: {
          tenant_id: tenantId,
          consumer_key: this.consumerKey,
          domain_event_id: eventId,
        },
      });
      const event = await tx.domainEvent.findFirst({
        where: { tenant_id: tenantId, id: eventId },
        select: {
          id: true,
          sequence: true,
          event_type: true,
          payload: true,
        },
      });
      if (!event) {
        return;
      }
      if (existing) {
        await this.advanceCursor(
          tx,
          tenantId,
          claimToken,
          event.sequence,
          event.id,
        );
        return;
      }

      const context = await this.loadDomainContext(tx, tenantId, event);
      const outcome = decideEstimateDecidedConsumerOutcome(context);
      let notificationOutboxId: string | null = null;
      if (outcome.kind === 'notify') {
        const enqueued = await this.outbox.enqueueInTx(tx, outcome.input, now);
        notificationOutboxId = enqueued.blocked ? null : enqueued.id;
      }
      await tx.domainEventConsumerDelivery.create({
        data: {
          tenant_id: tenantId,
          consumer_key: this.consumerKey,
          domain_event_id: event.id,
          outcome:
            outcome.kind === 'notify'
              ? DOMAIN_EVENT_CONSUMER_OUTCOME.notified
              : DOMAIN_EVENT_CONSUMER_OUTCOME.skipped,
          notification_outbox_id: notificationOutboxId,
        },
      });
      await this.advanceCursor(
        tx,
        tenantId,
        claimToken,
        event.sequence,
        event.id,
      );
    });
  }

  private async advanceCursor(
    tx: Prisma.TransactionClient,
    tenantId: string,
    claimToken: string,
    sequence: bigint,
    eventId: string,
  ): Promise<void> {
    await tx.domainEventConsumerProgress.updateMany({
      where: {
        tenant_id: tenantId,
        consumer_key: this.consumerKey,
        claim_token: claimToken,
        cursor_sequence: { lt: sequence },
      },
      data: {
        cursor_sequence: sequence,
        cursor_event_id: eventId,
      },
    });
  }

  private async loadDomainContext(
    tx: Prisma.TransactionClient,
    tenantId: string,
    event: {
      id: string;
      event_type: string;
      payload: Prisma.JsonValue | null;
    },
  ): Promise<EstimateDecidedDomainContext> {
    const parsedPayload = event.payload;
    const versionId =
      parsedPayload &&
      typeof parsedPayload === 'object' &&
      !Array.isArray(parsedPayload) &&
      typeof (parsedPayload as Record<string, unknown>).estimate_version_id ===
        'string'
        ? String((parsedPayload as Record<string, unknown>).estimate_version_id)
        : null;
    const version =
      versionId === null
        ? null
        : await tx.workshopEstimateVersion.findFirst({
            where: { tenant_id: tenantId, id: versionId },
            select: {
              id: true,
              status: true,
              estimate: {
                select: {
                  workshop_order_id: true,
                  workshop_order: { select: { site_id: true } },
                },
              },
            },
          });
    const orderId = version?.estimate.workshop_order_id ?? null;
    const waitingCustomerTaskCount =
      orderId === null
        ? 0
        : await tx.workshopTask.count({
            where: {
              tenant_id: tenantId,
              workshop_order_id: orderId,
              status: WorkshopTaskStatus.WAITING_CUSTOMER,
            },
          });
    return {
      eventId: event.id,
      tenantId,
      eventType: event.event_type,
      payload: event.payload,
      version,
      waitingCustomerTaskCount,
    };
  }
}
