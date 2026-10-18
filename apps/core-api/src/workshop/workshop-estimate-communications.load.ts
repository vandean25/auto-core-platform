import {
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WorkshopOrderCommunicationsResponseDto } from './dto/workshop-order-communications.dto.js';
import {
  buildWorkshopOrderCommunications,
  WORKSHOP_COMMUNICATIONS_LIMIT,
} from './workshop-order-communications.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import { findOrderInScope } from './workshop-estimate-order-access.js';

export async function loadWorkshopOrderCommunications(
  prisma: PrismaService,
  scope: EstimateScope,
  orderId: string,
): Promise<WorkshopOrderCommunicationsResponseDto> {
  await findOrderInScope(prisma, scope, orderId);
  const versions = await prisma.workshopEstimateVersion.findMany({
    where: {
      tenant_id: scope.tenantId,
      estimate: { workshop_order_id: orderId, site_id: scope.siteId },
    },
    select: { id: true, version: true },
  });
  const versionIds = versions.map((version) => version.id);
  const [emails, readyEmails, approvals, overrunRecords] = await Promise.all([
    prisma.notificationOutbox.findMany({
      where: {
        tenant_id: scope.tenantId,
        workshop_order_id: orderId,
        event_type: NotificationEventType.CUSTOMER_ESTIMATE_SENT,
        channel: NotificationChannel.EMAIL,
        recipient_kind: NotificationRecipientKind.CUSTOMER,
        source_entity_type: 'WorkshopEstimateVersion',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: WORKSHOP_COMMUNICATIONS_LIMIT,
      select: {
        id: true,
        status: true,
        createdAt: true,
        source_entity_id: true,
      },
    }),
    prisma.notificationOutbox.findMany({
      where: {
        tenant_id: scope.tenantId,
        workshop_order_id: orderId,
        event_type: NotificationEventType.WORKSHOP_ORDER_READY,
        channel: NotificationChannel.EMAIL,
        recipient_kind: NotificationRecipientKind.CUSTOMER,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: WORKSHOP_COMMUNICATIONS_LIMIT,
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    }),
    versionIds.length === 0
      ? []
      : prisma.workshopEstimateApproval.findMany({
          where: {
            tenant_id: scope.tenantId,
            workshop_estimate_version_id: { in: versionIds },
          },
          orderBy: [{ decided_at: 'desc' }, { id: 'desc' }],
          take: WORKSHOP_COMMUNICATIONS_LIMIT,
          select: {
            id: true,
            workshop_estimate_version_id: true,
            channel: true,
            decision: true,
            decided_at: true,
          },
        }),
    prisma.workshopEstimateOverrun.findMany({
      where: {
        tenant_id: scope.tenantId,
        workshop_estimate_version_id: { in: versionIds },
      },
      orderBy: [{ detected_at: 'desc' }, { id: 'desc' }],
      take: WORKSHOP_COMMUNICATIONS_LIMIT,
      select: {
        id: true,
        workshop_estimate_version_id: true,
        detected_at: true,
        notified_at: true,
        notified_channel: true,
      },
    }),
  ]);
  const versionNumbers = new Map(
    versions.map((version): [string, number] => [version.id, version.version]),
  );
  return {
    data: buildWorkshopOrderCommunications({
      emails,
      readyEmails,
      approvals,
      overrunRecords,
      versionNumbers,
    }),
  };
}
