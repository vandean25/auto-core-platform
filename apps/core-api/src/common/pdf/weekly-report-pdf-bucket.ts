import { resolvePdfStorageBucket } from './pdf-bucket.js';

/**
 * Ephemeral weekly-report PDFs. Override with WEEKLY_REPORT_PDF_BUCKET when infra
 * provisions a dedicated short-lived bucket; otherwise the invoice PDF bucket is used.
 */
export function resolveWeeklyReportPdfBucket(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dedicated = env.WEEKLY_REPORT_PDF_BUCKET?.trim();
  if (dedicated) {
    return dedicated;
  }
  return resolvePdfStorageBucket(env);
}

/** GCS object prefix for weekly-report PDFs that must not live as permanent archives. */
export const WEEKLY_REPORT_EPHEMERAL_PREFIX = 'ephemeral/weekly-reports';

/**
 * Infra should add a bucket lifecycle rule (not applied by apply-gcs-lifecycle.ts today):
 * Delete objects under `ephemeral/weekly-reports/` when customTime is older than now
 * (objects set customTime on upload; app also deletes expired metadata in-code).
 */
export const WEEKLY_REPORT_EPHEMERAL_GCS_LIFECYCLE_RULE = {
  action: { type: 'Delete' as const },
  condition: {
    matchesPrefix: [`${WEEKLY_REPORT_EPHEMERAL_PREFIX}/`],
    daysSinceCustomTime: 1,
  },
};

export function weeklyReportObjectExpiresAt(
  uploadedAt: Date,
  retentionHours = 24,
): Date {
  return new Date(uploadedAt.getTime() + retentionHours * 60 * 60 * 1000);
}
