import { ConflictException } from '@nestjs/common';
import { WorkshopEstimateStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { assertBackOfficeRole } from './workshop-estimate-scope.js';
import {
  proposeEstimateSendInputSchema,
  type ProposeEstimateSendInput,
} from './workshop-estimate-send-propose.schema.js';
import type {
  EstimateSendProposePreview,
  EstimateSendProposeResult,
} from './workshop-estimate-send-propose.service.js';

export type EstimateSendPreviewHost = {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  planSend: (
    parsed: ProposeEstimateSendInput,
    tenantId: string,
    siteId: string,
  ) => Promise<{
    preview: EstimateSendProposePreview;
    draftVersionId: string | null;
  }>;
  assertPinnedState: (
    parsed: ProposeEstimateSendInput,
    plan: {
      digest: string;
      customerId: string;
      recipientPin: string;
      draftVersionId: string | null;
      needsCreateEstimate: boolean;
      needsRevision: boolean;
      validUntilIso: string | null;
    },
  ) => void;
  mapSentVersion: (
    version: {
      id: string;
      status: WorkshopEstimateStatus;
      estimate: { estimate_number: string };
      total_gross: import('@prisma/client').Prisma.Decimal | null;
      total_net: import('@prisma/client').Prisma.Decimal | null;
      total_tax: import('@prisma/client').Prisma.Decimal | null;
      valid_until: Date | null;
    },
    orderId: string,
    siteId: string,
    plan: {
      recipientEmail: string;
      preview: EstimateSendProposePreview;
    },
  ) => EstimateSendProposeResult;
};

type EstimateSendProposeServiceInternals = {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  planSend: EstimateSendPreviewHost['planSend'];
  assertPinnedState: EstimateSendPreviewHost['assertPinnedState'];
  mapSentVersion: EstimateSendPreviewHost['mapSentVersion'];
};

export function bindEstimateSendPreviewHost(
  service: import('./workshop-estimate-send-propose.service.js').WorkshopEstimateSendProposeService,
): EstimateSendPreviewHost {
  const internal = service as unknown as EstimateSendProposeServiceInternals;
  return {
    prisma: internal.prisma,
    tenantContext: internal.tenantContext,
    siteContext: internal.siteContext,
    planSend: (...args) => internal.planSend(...args),
    assertPinnedState: (parsed, plan) =>
      internal.assertPinnedState(parsed, plan),
    mapSentVersion: (...args) => internal.mapSentVersion(...args),
  };
}

export async function runEstimateSendPreview(
  host: EstimateSendPreviewHost,
  input: unknown,
  executionContext?: Record<string, unknown>,
): Promise<EstimateSendProposeResult> {
  assertBackOfficeRole(
    host.tenantContext,
    'Sending workshop estimates through MCP',
  );
  const parsed = proposeEstimateSendInputSchema.parse(input);
  const tenantId = await host.tenantContext.getTenantId();
  await requireActiveCurrentUser(host.prisma, host.tenantContext, tenantId);

  const expectedSiteId =
    typeof executionContext?.site_id === 'string'
      ? executionContext.site_id
      : await host.siteContext.getSiteId();

  const orderId = parsed.pinned_workshop_order_id ?? parsed.workshop_order_id;
  if (orderId !== parsed.workshop_order_id) {
    throw new ConflictException(
      'Workshop order id does not match the pinned proposal order',
    );
  }

  const plan = await host.planSend(parsed, tenantId, expectedSiteId);
  if (parsed.pinned_lines_digest) {
    host.assertPinnedState(parsed, plan);
  }

  const versionId = plan.draftVersionId;
  if (versionId) {
    const existing = await host.prisma.workshopEstimateVersion.findFirst({
      where: {
        id: versionId,
        tenant_id: tenantId,
        estimate: { workshop_order_id: orderId, site_id: expectedSiteId },
      },
      select: {
        id: true,
        status: true,
        estimate: { select: { estimate_number: true } },
        total_gross: true,
        total_net: true,
        total_tax: true,
        valid_until: true,
      },
    });
    if (!existing) {
      throw new ConflictException(
        'The estimate version for this proposal is no longer available',
      );
    }
    if (existing.status === WorkshopEstimateStatus.SENT) {
      return host.mapSentVersion(existing, orderId, expectedSiteId, plan);
    }
    if (existing.status === WorkshopEstimateStatus.DRAFT) {
      return {
        id: existing.id,
        entityId: existing.id,
        workshop_order_id: orderId,
        site_id: expectedSiteId,
        channel: 'email',
        estimate_number: existing.estimate.estimate_number,
        estimate_version_id: existing.id,
        status: WorkshopEstimateStatus.DRAFT,
        recipient_email_masked: plan.preview.recipient_email_masked,
        lines: plan.preview.lines,
        totals: plan.preview.totals,
        valid_until: existing.valid_until?.toISOString() ?? null,
      };
    }
    throw new ConflictException(
      'The estimate version changed since this proposal was created',
    );
  }

  const previewVersionId = plan.preview.estimate_version_id;
  return {
    id: previewVersionId,
    entityId: previewVersionId,
    workshop_order_id: orderId,
    site_id: expectedSiteId,
    channel: 'email',
    estimate_number: plan.preview.estimate_number,
    estimate_version_id: previewVersionId,
    status: WorkshopEstimateStatus.DRAFT,
    recipient_email_masked: plan.preview.recipient_email_masked,
    lines: plan.preview.lines,
    totals: plan.preview.totals,
    valid_until: plan.preview.valid_until,
  };
}
