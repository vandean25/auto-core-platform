import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { getFirebaseErrorCode } from '../../tenant-member/tenant-member.firebase.js';

const INVALID_TOKEN_CODES = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/user-disabled',
]);

export function throwMappedFirebaseVerifyError(error: unknown): never {
  const code = getFirebaseErrorCode(error);
  if (code && INVALID_TOKEN_CODES.has(code)) {
    throw new UnauthorizedException('Invalid or revoked token.');
  }
  if (isTransportFailure(error)) {
    throw new ServiceUnavailableException('Identity provider is unavailable.');
  }
  throw new ServiceUnavailableException('Identity provider is unavailable.');
}

export function throwMappedFirebaseRevokeError(error: unknown): never {
  if (isTransportFailure(error)) {
    throw new ServiceUnavailableException('Identity provider is unavailable.');
  }
  throw new ServiceUnavailableException('Identity provider is unavailable.');
}

function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('unavailable') ||
    message.includes('timeout')
  );
}
