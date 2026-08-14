import { InternalServerErrorException } from '@nestjs/common';

/** Shared GCS bucket for invoice PDFs and workshop job-card PDFs. */
export function resolvePdfStorageBucket(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const bucket = env.INVOICE_PDF_BUCKET?.trim();
  if (!bucket) {
    throw new InternalServerErrorException(
      'INVOICE_PDF_BUCKET environment variable is not configured',
    );
  }
  return bucket;
}
