import { ServiceUnavailableException } from '@nestjs/common';
import type { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { WorkshopEstimateVersionDetailDto } from './dto/workshop-estimate-response.dto.js';
import { isCustomerEstimateSendEnabled } from './workshop-estimate.constants.js';
import { parseApprovalBaseUrl } from './workshop-estimate-approval-token.helpers.js';
import { wakeUpAfterCommit } from './workshop-estimate-email-queue.js';
import type { WorkshopEstimatePdfService } from './workshop-estimate-pdf.service.js';
import { queueEstimatePdfAfterSend } from './workshop-estimate-after-send.js';
import { readWorkshopEstimateVersion } from './workshop-estimate-read.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import { assertEstimateRole } from './workshop-estimate-scope.js';
import type { EstimateSendOptions } from './workshop-estimate-send.options.js';
import { commitSendVersionInTx } from './workshop-estimate-send.transaction.js';
import { mapEstimateWriteError } from './workshop-estimate-write-errors.js';

export type SendWorkshopEstimateVersionDeps = {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  outbox: NotificationOutboxService;
  wakeUps: NotificationCloudTasksService;
  pdf: WorkshopEstimatePdfService;
  scope: EstimateScope;
};

export async function sendWorkshopEstimateVersion(
  deps: SendWorkshopEstimateVersionDeps,
  versionId: string,
  options: EstimateSendOptions,
): Promise<WorkshopEstimateVersionDetailDto> {
  assertEstimateRole(deps.tenantContext);
  if (!isCustomerEstimateSendEnabled()) {
    throw new ServiceUnavailableException({
      code: 'ESTIMATE_SEND_DISABLED',
      message:
        'Sending estimates to customers is disabled until the legal copy is approved.',
    });
  }
  const approvalBaseUrl = options.notifyCustomerByEmail
    ? parseApprovalBaseUrl(process.env.ESTIMATE_APPROVAL_BASE_URL)
    : null;
  if (options.notifyCustomerByEmail && approvalBaseUrl === null) {
    throw new ServiceUnavailableException({
      code: 'ESTIMATE_APPROVAL_LINK_UNAVAILABLE',
      message:
        'The approval link base is not configured, so the estimate cannot be emailed.',
    });
  }

  const queuedOutboxId = await deps.prisma
    .$transaction((tx) =>
      commitSendVersionInTx(tx, {
        scope: deps.scope,
        versionId,
        options,
        approvalBaseUrl,
        outbox: deps.outbox,
      }),
    )
    .catch(mapEstimateWriteError);

  await queueEstimatePdfAfterSend(deps.pdf, deps.scope, versionId);
  if (queuedOutboxId !== null) {
    await wakeUpAfterCommit(deps.wakeUps, queuedOutboxId, deps.scope.tenantId);
  }
  return readWorkshopEstimateVersion(deps.prisma, deps.scope, versionId);
}
