import { HttpException } from '@nestjs/common';
import type { Response } from 'express';

export async function withQuotaRetryAfter<T>(
  action: () => Promise<T>,
  response: Pick<Response, 'setHeader'>,
  quotaCode: string,
  retryAfterSeconds: number,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() === 429) {
      const body = error.getResponse();
      if (
        body &&
        typeof body === 'object' &&
        'code' in body &&
        body.code === quotaCode
      ) {
        response.setHeader('Retry-After', String(retryAfterSeconds));
      }
    }
    throw error;
  }
}
