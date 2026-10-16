import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationEventType,
  NotificationOutboxStatus,
  WorkshopEstimateStatus,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
  type Prisma,
} from '@prisma/client';
import type { SupervisionTriageCandidate } from '../agent-supervision/agent-supervision-triage-order.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { customerWaitingTriageRecordLink } from './workshop-order-communications.js';

type EstimateDecisionNoticePayload = {
  decision?: string;
  estimate_version_id?: string;
  workshop_order_id?: string;
  needs_human_review?: boolean;
};

@Injectable()
export class WorkshopEstimateDecisionTriageService {
  constructor(private readonly prisma: PrismaService) {}

  async listCustomerDecisionTriageCandidates(
    tenantId: string,
    siteIds: readonly string[],
  ): Promise<SupervisionTriageCandidate[]> {
    if (siteIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.notificationOutbox.findMany({
      where: {
        tenant_id: tenantId,
        event_type: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
        channel: NotificationChannel.IN_APP,
        status: NotificationOutboxStatus.ACCEPTED,
        workshop_order: { site_id: { in: [...siteIds] } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        payload: true,
        workshop_order_id: true,
        workshop_order: { select: { site_id: true } },
        source_entity_id: true,
      },
    });

    const versionIds = [
      ...new Set(
        rows
          .map((row) => readPayload(row.payload)?.estimate_version_id)
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    ];
    const versions =
      versionIds.length === 0
        ? []
        : await this.prisma.workshopEstimateVersion.findMany({
            where: { tenant_id: tenantId, id: { in: versionIds } },
            select: { id: true, status: true },
          });
    const versionStatus = new Map(versions.map((v) => [v.id, v.status]));

    const candidateOrderIds = [
      ...new Set(
        rows
          .map((row) => {
            const payload = readPayload(row.payload);
            return payload?.workshop_order_id ?? row.workshop_order_id;
          })
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    ];
    const orders =
      candidateOrderIds.length === 0
        ? []
        : await this.prisma.workshopOrder.findMany({
            where: { tenant_id: tenantId, id: { in: candidateOrderIds } },
            select: { id: true, status: true },
          });
    const orderStatus = new Map(orders.map((o) => [o.id, o.status]));
    const waitingTaskGroups =
      candidateOrderIds.length === 0
        ? []
        : await this.prisma.workshopTask.groupBy({
            by: ['workshop_order_id'],
            where: {
              tenant_id: tenantId,
              workshop_order_id: { in: candidateOrderIds },
              status: WorkshopTaskStatus.WAITING_CUSTOMER,
            },
            _count: { _all: true },
          });
    const waitingCustomerCountByOrder = new Map(
      waitingTaskGroups.map((g) => [g.workshop_order_id, g._count._all]),
    );

    const items: SupervisionTriageCandidate[] = [];
    for (const row of rows) {
      const payload = readPayload(row.payload);
      const versionId = payload?.estimate_version_id ?? row.source_entity_id;
      if (!versionId) {
        continue;
      }
      const status = versionStatus.get(versionId);
      if (
        status === undefined ||
        status === WorkshopEstimateStatus.SUPERSEDED ||
        status === WorkshopEstimateStatus.SENT ||
        status === WorkshopEstimateStatus.DRAFT ||
        status === WorkshopEstimateStatus.EXPIRED
      ) {
        continue;
      }
      const siteId = row.workshop_order?.site_id;
      if (!siteId || !siteIds.includes(siteId)) {
        continue;
      }
      const orderId =
        payload?.workshop_order_id ?? row.workshop_order_id ?? null;
      if (!orderId) {
        continue;
      }
      const orderState = orderStatus.get(orderId);
      if (
        orderState === WorkshopOrderStatus.COMPLETED ||
        orderState === WorkshopOrderStatus.INVOICED
      ) {
        continue;
      }
      const waitingCustomerCount =
        waitingCustomerCountByOrder.get(orderId) ?? 0;
      const reason = triageReasonFromPayload(payload, waitingCustomerCount);
      items.push({
        kind: 'CUSTOMER_DECISION',
        entity_id: row.id,
        site_id: siteId,
        reason,
        created_at: row.createdAt,
        due_at: null,
        record_link: customerWaitingTriageRecordLink(orderId),
        allowed_action: 'OPEN_RECORD',
      });
    }
    return items;
  }
}

function readPayload(
  payload: Prisma.JsonValue | null,
): EstimateDecisionNoticePayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  return payload;
}

function triageReasonFromPayload(
  payload: EstimateDecisionNoticePayload | null,
  waitingCustomerCount: number,
): string {
  const decision = payload?.decision;
  const needsReview =
    payload?.needs_human_review === true && waitingCustomerCount > 0;
  if (decision === 'APPROVED') {
    return needsReview
      ? 'CUSTOMER_ESTIMATE_APPROVED_REVIEW_WAITING_TASKS'
      : 'CUSTOMER_ESTIMATE_APPROVED';
  }
  if (decision === 'DECLINED') {
    return needsReview
      ? 'CUSTOMER_ESTIMATE_DECLINED_REVIEW_WAITING_TASKS'
      : 'CUSTOMER_ESTIMATE_DECLINED';
  }
  return 'CUSTOMER_ESTIMATE_DECIDED';
}
