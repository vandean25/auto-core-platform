import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { DomainEventStoreService } from '../domain-event-store/domain-event-store.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import type { ContactPermissionReason } from '../customer-consent/customer-consent.permissions.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeSellerReadiness } from '../site/legal-entity-readiness.js';
import { appendWorkshopOrderReadyDomainEvent } from './workshop-domain-event.helpers.js';
import {
  assertBackOfficeRole,
  resolveActorUserId,
  resolveEstimateScope,
} from './workshop-estimate-scope.js';
import { wakeUpAfterCommit } from './workshop-estimate-email-queue.js';
import { buildWorkshopOrderReadyCustomerEmail } from './workshop-order-ready-customer-email.js';
import { workshopOrderReadyCompletionOccurrenceId } from './workshop-order-ready.constants.js';
import {
  readyEmailNoticeMessage,
  resolveReadyEmailNotice,
  type WorkshopReadyEmailNotice,
} from './workshop-order-ready-notice.js';

type QueueReadyEmailInTxResult =
  | { status: 'queued'; outboxId: string }
  | {
      status: 'skipped';
      skipReason:
        | 'missing_site'
        | 'seller_incomplete'
        | 'email_not_buildable'
        | 'consent_blocked';
      contactPermissionReason?: ContactPermissionReason;
    };

const ORDER_READY_SELECT = {
  id: true,
  order_number: true,
  status: true,
  purpose: true,
  customer: {
    select: {
      id: true,
      contact_email_ok: true,
      email: true,
      preferred_language: true,
    },
  },
  vehicle: { select: { make: true, model: true } },
  site_id: true,
} satisfies Prisma.WorkshopOrderSelect;

@Injectable()
export class WorkshopOrderReadyEmailService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
    @Inject(NotificationOutboxService)
    private readonly outbox: NotificationOutboxService,
    @Inject(NotificationCloudTasksService)
    private readonly wakeUps: NotificationCloudTasksService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RequestContextService)
    private readonly requestContext: RequestContextService,
    @Inject(DomainEventStoreService)
    private readonly domainEventStore: DomainEventStoreService,
  ) {}

  /**
   * Called inside the same transaction that moves an order to COMPLETED. Queues at most one automatic
   * ready email per completion occurrence.
   */
  async onOrderCompletedInTx(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      siteId: string;
      orderId: string;
      occurredAt: Date;
    },
  ): Promise<string | null> {
    const order = await tx.workshopOrder.findFirst({
      where: {
        id: input.orderId,
        tenant_id: input.tenantId,
        site_id: input.siteId,
        status: WorkshopOrderStatus.COMPLETED,
      },
      select: ORDER_READY_SELECT,
    });
    if (!order || order.purpose !== WorkshopOrderPurpose.CUSTOMER_REPAIR) {
      return null;
    }
    const queued = await this.queueReadyEmailInTx(tx, {
      tenantId: input.tenantId,
      siteId: input.siteId,
      order,
      occurrenceId: workshopOrderReadyCompletionOccurrenceId(input.orderId),
      resend: false,
      actorUserId: null,
      occurredAt: input.occurredAt,
    });
    return queued.status === 'queued' ? queued.outboxId : null;
  }

  async resend(orderId: string): Promise<WorkshopReadyEmailNotice> {
    assertBackOfficeRole(
      this.tenantContext,
      'Resending the ready-for-pickup email',
    );
    const scope = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    const actorUserId = await resolveActorUserId({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      tenantId: scope.tenantId,
    });
    const occurredAt = new Date();
    const occurrenceId = randomUUID();
    const queuedOutboxId = await this.prisma
      .$transaction(async (tx) => {
        const order = await tx.workshopOrder.findFirst({
          where: {
            id: orderId,
            tenant_id: scope.tenantId,
            site_id: scope.siteId,
          },
          select: ORDER_READY_SELECT,
        });
        if (!order) {
          throw new NotFoundException('Workshop order not found');
        }
        if (order.status !== WorkshopOrderStatus.COMPLETED) {
          throw new ConflictException({
            code: 'WORKSHOP_ORDER_NOT_COMPLETED',
            message:
              'The ready-for-pickup email can only be sent when the order is completed.',
          });
        }
        if (order.purpose !== WorkshopOrderPurpose.CUSTOMER_REPAIR) {
          throw new ConflictException({
            code: 'READY_EMAIL_NOT_APPLICABLE',
            message: 'This order does not use customer ready notices.',
          });
        }
        const queued = await this.queueReadyEmailInTx(tx, {
          tenantId: scope.tenantId,
          siteId: scope.siteId,
          order,
          occurrenceId,
          resend: true,
          actorUserId,
          occurredAt,
        });
        if (queued.status === 'skipped') {
          if (queued.skipReason === 'consent_blocked') {
            throw new UnprocessableEntityException({
              code: 'READY_EMAIL_CONTACT_CONSENT_BLOCKED',
              message:
                'The ready notice cannot be sent because customer contact permission is not granted or has been withdrawn.',
              reason: queued.contactPermissionReason ?? null,
            });
          }
          throw new UnprocessableEntityException({
            code: 'READY_EMAIL_BLOCKED',
            message:
              'The ready notice cannot be sent until customer contact details are complete.',
          });
        }
        const outboxId = queued.outboxId;
        await this.audit.recordTenantMutation(
          {
            entityType: 'NotificationOutbox',
            entityId: outboxId,
            action: AuditLogAction.CREATE,
            actorUserId,
            source: 'workshop-order-ready-resend',
            after: {
              workshop_order_id: orderId,
              event_type: NotificationEventType.WORKSHOP_ORDER_READY,
              occurrence_id: occurrenceId,
              resend: true,
            },
          },
          tx,
        );
        return outboxId;
      })
      .catch((error) => {
        if (
          error instanceof UnprocessableEntityException ||
          error instanceof ConflictException ||
          error instanceof NotFoundException
        ) {
          throw error;
        }
        throw error;
      });

    await wakeUpAfterCommit(this.wakeUps, queuedOutboxId, scope.tenantId);
    const notice = await this.loadNoticeForOrder(
      scope.tenantId,
      scope.siteId,
      orderId,
    );
    if (!notice) {
      return {
        code: 'QUEUED',
        message: readyEmailNoticeMessage('QUEUED'),
      };
    }
    return notice;
  }

  async loadNoticeForOrder(
    tenantId: string,
    siteId: string,
    orderId: string,
  ): Promise<WorkshopReadyEmailNotice | null> {
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: ORDER_READY_SELECT,
    });
    if (!order) {
      return null;
    }
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId },
      select: { legal_entity: true },
    });
    const sellerReady = site
      ? computeSellerReadiness(site.legal_entity).isReady
      : false;
    const latest = await this.prisma.notificationOutbox.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
        event_type: NotificationEventType.WORKSHOP_ORDER_READY,
        channel: NotificationChannel.EMAIL,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { status: true },
    });
    return resolveReadyEmailNotice({
      orderStatus: order.status,
      purpose: order.purpose,
      customer: order.customer,
      vehicle: order.vehicle,
      sellerName: site?.legal_entity.name ?? '',
      sellerReady,
      latestReadyEmailStatus: latest?.status ?? null,
    });
  }

  private async queueReadyEmailInTx(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      siteId: string;
      order: Prisma.WorkshopOrderGetPayload<{
        select: typeof ORDER_READY_SELECT;
      }>;
      occurrenceId: string;
      resend: boolean;
      actorUserId: string | null;
      occurredAt: Date;
    },
  ): Promise<QueueReadyEmailInTxResult> {
    const site = await tx.site.findFirst({
      where: { id: input.siteId, tenant_id: input.tenantId },
      select: { legal_entity: true },
    });
    if (!site) {
      return { status: 'skipped', skipReason: 'missing_site' };
    }
    const sellerReady = computeSellerReadiness(site.legal_entity).isReady;
    if (!sellerReady) {
      return { status: 'skipped', skipReason: 'seller_incomplete' };
    }
    const tenant = await tx.tenant.findFirst({
      where: { id: input.tenantId },
      select: { default_locale: true },
    });
    const built = buildWorkshopOrderReadyCustomerEmail({
      customer: input.order.customer,
      vehicle: input.order.vehicle,
      sellerName: site.legal_entity.name,
      orderNumber: input.order.order_number,
      tenantDefaultLocale: tenant?.default_locale ?? 'de',
    });
    if (!built.ok) {
      return { status: 'skipped', skipReason: 'email_not_buildable' };
    }
    const enqueued = await this.outbox.enqueueInTx(
      tx,
      {
        tenantId: input.tenantId,
        eventType: NotificationEventType.WORKSHOP_ORDER_READY,
        occurrenceId: input.occurrenceId,
        channel: NotificationChannel.EMAIL,
        recipientKind: NotificationRecipientKind.CUSTOMER,
        recipientKey: `customer:${input.order.customer!.id}`,
        workshopOrderId: input.order.id,
        sourceEntityType: 'WorkshopOrder',
        sourceEntityId: input.order.id,
        consentPurpose: 'ORDER_COMMUNICATION',
        controllerLegalEntityId: site.legal_entity.id,
        email: built.draft,
        payload: {
          customer_id: input.order.customer!.id,
          resend: input.resend,
          ...(input.actorUserId ? { actor_user_id: input.actorUserId } : {}),
        },
      },
      input.occurredAt,
    );
    if (enqueued.blocked) {
      return {
        status: 'skipped',
        skipReason: 'consent_blocked',
        contactPermissionReason: enqueued.reason,
      };
    }
    const { id, created } = enqueued;
    if (created) {
      await appendWorkshopOrderReadyDomainEvent(tx, this.domainEventStore, {
        tenantId: input.tenantId,
        siteId: input.siteId,
        workshopOrderId: input.order.id,
        occurrenceId: input.occurrenceId,
        outboxId: id,
        resend: input.resend,
        occurredAt: input.occurredAt,
        traceId: this.requestContext.getTraceId() ?? id,
      });
    }
    return { status: 'queued', outboxId: id };
  }
}
