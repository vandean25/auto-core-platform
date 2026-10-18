import { HttpException } from '@nestjs/common';

const TRANSIENT_RETRY_DELAYS_SECONDS = [5, 20];

export class ExtractionFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function retryDelaySeconds(
  error: unknown,
  attemptCount: number,
): number | undefined {
  return isTransientExtractionError(error)
    ? TRANSIENT_RETRY_DELAYS_SECONDS[attemptCount - 1]
    : undefined;
}

export function isTransientExtractionError(error: unknown): boolean {
  if (error instanceof ExtractionFailure) {
    return error.code === 'BRAND_EXTRACTION_ATTEMPT_TIMEOUT';
  }
  if (error instanceof HttpException) {
    return error.getStatus() === 429 || error.getStatus() >= 500;
  }
  return true;
}

export function extractionFailureCode(error: unknown): string {
  if (error instanceof ExtractionFailure) return error.code;
  if (error instanceof HttpException && error.getStatus() < 500) {
    const response = error.getResponse();
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      typeof response.code === 'string' &&
      /^BRAND_[A-Z0-9_]{1,60}$/.test(response.code)
    ) {
      return response.code;
    }
  }
  return 'BRAND_EXTRACTION_FAILED';
}

export function safeExtractionWorkerError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
