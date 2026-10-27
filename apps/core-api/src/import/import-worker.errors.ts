export class ImportWorkerLeaseLostError extends Error {
  readonly name = 'ImportWorkerLeaseLostError';
}

/** Lease loss during apply — not retryable Prisma/storage errors (those re-queue separately). */
export function isImportWorkerContentionError(error: unknown): boolean {
  return error instanceof ImportWorkerLeaseLostError;
}
