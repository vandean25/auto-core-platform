/** Cloud Run core-api URL for import worker tasks (never the PDF worker). */
export function resolveImportWorkerTargetBaseUrl(): string | undefined {
  const notification =
    process.env.CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL?.trim();
  if (notification) {
    return notification;
  }
  return process.env.CLOUD_TASKS_TARGET_BASE_URL?.trim();
}
