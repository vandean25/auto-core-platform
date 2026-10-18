import { Logger } from '@nestjs/common';
import type { WorkshopEstimatePdfService } from './workshop-estimate-pdf.service.js';
import type { EstimateScope } from './workshop-estimate-scope.js';

const logger = new Logger('WorkshopEstimateAfterSend');

export function cloudTasksTargetBaseUrl(): string {
  return process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';
}

/**
 * The send is committed before this runs. A PDF that cannot be queued leaves the
 * version without an archive, and the workshop can request it again, so the send
 * itself still succeeds.
 */
export async function queueEstimatePdfAfterSend(
  pdf: WorkshopEstimatePdfService,
  scope: EstimateScope,
  versionId: string,
): Promise<void> {
  try {
    await pdf.requestGeneration(scope, versionId, {
      targetBaseUrl: cloudTasksTargetBaseUrl(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Estimate PDF was not queued after send for ${versionId}: ${message}`,
    );
  }
}
