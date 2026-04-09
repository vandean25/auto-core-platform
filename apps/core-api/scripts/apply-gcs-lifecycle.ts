/**
 * Applies the GCS lifecycle policy to the invoice PDF bucket.
 * Safe to run multiple times (idempotent — GCS replaces the full lifecycle config).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/apply-gcs-lifecycle.ts
 *
 * Required env vars:
 *   INVOICE_PDF_BUCKET   — target bucket name
 *   GCP_CREDENTIALS      — optional JSON string (fallback: ADC)
 */

import { Storage } from '@google-cloud/storage';

export const LIFECYCLE_RULES = [
  {
    action: { type: 'SetStorageClass' as const, storageClass: 'COLDLINE' },
    condition: { age: 90 },
  },
  {
    action: { type: 'Delete' as const },
    condition: { age: 2555 },
  },
];

export async function applyGcsLifecycle(): Promise<void> {
  const bucketName = process.env.INVOICE_PDF_BUCKET;
  if (!bucketName) {
    throw new Error('INVOICE_PDF_BUCKET environment variable is not set.');
  }

  let storage: Storage;
  const credentials = process.env.GCP_CREDENTIALS;
  if (credentials) {
    try {
      storage = new Storage({ credentials: JSON.parse(credentials) });
    } catch (err) {
      throw new Error(
        `Failed to parse GCP_CREDENTIALS JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    storage = new Storage();
  }

  const bucket = storage.bucket(bucketName);

  await bucket.setMetadata({ lifecycle: { rule: LIFECYCLE_RULES } });

  console.log(
    `Lifecycle policy applied to bucket "${bucketName}" with rules:`,
  );
  LIFECYCLE_RULES.forEach((rule, i) => {
    console.log(
      `  [${i + 1}] action=${JSON.stringify(rule.action)}  condition=${JSON.stringify(rule.condition)}`,
    );
  });
}

// Only execute when run directly (not when imported in tests)
if (require.main === module) {
  applyGcsLifecycle()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : 'Unexpected error: ' + String(err));
      process.exit(1);
    });
}
