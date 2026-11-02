import { createHash } from 'node:crypto';

/**
 * Deterministic Cloud Task ID for scheduled import row purge batches (AUT-839).
 * Format: import-purge-<hex-digest-40>
 */
export function deterministicImportPurgeTaskId(
  runId: string,
  sequence: number,
): string {
  const digest = createHash('sha256')
    .update(`import-row-purge:${runId}:${sequence}`)
    .digest('hex');
  return `import-purge-${digest.slice(0, 40)}`;
}
