import { WorkshopEstimateStatus, type Prisma } from '@prisma/client';
import { calendarYearInVienna } from './workshop-estimate-number.helpers.js';

/** Never converted: keep to 31 Dec of document year + 3 (ADR-0025 §10; lawyer to confirm). */
export const WORKSHOP_ESTIMATE_NEVER_CONVERTED_RETENTION_YEARS = 3;
/** Converted to an invoice: keep to 31 Dec of document year + 7 (UGB § 212 Abs 2, BAO § 132 Abs 1). */
export const WORKSHOP_ESTIMATE_INVOICED_RETENTION_YEARS = 7;

/** End of 31 December in Vienna (CET, UTC+1 in winter), so the cut-off is the local day's end. */
export function endOfDecemberRetention(
  documentYear: number,
  years: number,
): Date {
  return new Date(`${documentYear + years}-12-31T23:59:59.999+01:00`);
}

export function retainUntilAtSend(sentAt: Date): Date {
  return endOfDecemberRetention(
    calendarYearInVienna(sentAt),
    WORKSHOP_ESTIMATE_NEVER_CONVERTED_RETENTION_YEARS,
  );
}

/**
 * When the linked order is invoiced, sent versions move to the longer period.
 * Only ever extends: a later date already stored is kept. Returns the number of
 * rows changed. Drafts have no document yet and are never touched.
 */
export async function extendEstimateRetentionForInvoicedOrder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workshopOrderId: string,
): Promise<number> {
  const estimate = await tx.workshopEstimate.findFirst({
    where: { tenant_id: tenantId, workshop_order_id: workshopOrderId },
    select: { id: true },
  });
  if (!estimate) {
    return 0;
  }

  const sentVersions = await tx.workshopEstimateVersion.findMany({
    where: {
      tenant_id: tenantId,
      estimate_id: estimate.id,
      status: { not: WorkshopEstimateStatus.DRAFT },
      sent_at: { not: null },
    },
    select: { sent_at: true },
  });

  const documentYears = new Set(
    sentVersions.map((version) => calendarYearInVienna(version.sent_at!)),
  );
  const results = await Promise.all(
    [...documentYears].map((documentYear) => {
      const target = endOfDecemberRetention(
        documentYear,
        WORKSHOP_ESTIMATE_INVOICED_RETENTION_YEARS,
      );
      return tx.workshopEstimateVersion.updateMany({
        where: {
          tenant_id: tenantId,
          estimate_id: estimate.id,
          status: { not: WorkshopEstimateStatus.DRAFT },
          sent_at: {
            gte: new Date(`${documentYear}-01-01T00:00:00.000+01:00`),
            lte: endOfDecemberRetention(documentYear, 0),
          },
          OR: [{ retain_until: null }, { retain_until: { lt: target } }],
        },
        data: { retain_until: target },
      });
    }),
  );
  return results.reduce((sum, result) => sum + result.count, 0);
}
