import { createHash } from 'node:crypto';

export function taskIdFromName(taskName: string): string {
  return taskName.split('/').pop() || taskName;
}

export function deterministicExtractionTaskId(
  extractionId: string,
  expectedAttemptCount: number,
): string {
  const digest = createHash('sha256')
    .update(`${extractionId}:${expectedAttemptCount}`)
    .digest('hex');
  return `document-branding-extraction-${digest.slice(0, 40)}`;
}

export function cloudTasksErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'number' ? error.code : null;
}
