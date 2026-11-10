import {
  guardedRequestInvalid,
  idempotencyKeyExpired,
} from './guarded-price.errors.js';
import { isUuidV7, uuidV7TimestampMillis } from './guarded-price.uuid.js';

const ADMISSION_PAST_MS = 24 * 60 * 60 * 1000;
const ADMISSION_FUTURE_MS = 5 * 60 * 1000;

export function resolveOperationKey(
  headerValue: string | undefined,
  queryOperationKey: string | undefined,
): string {
  const raw = headerValue?.trim() || queryOperationKey?.trim() || '';
  if (!raw) {
    guardedRequestInvalid(
      'A UUIDv7 Idempotency-Key header or operationKey query is required.',
    );
  }
  if (!isUuidV7(raw)) {
    guardedRequestInvalid('Operation key must be a UUIDv7.');
  }
  return raw;
}

export function assertKeyAdmissionOnNoRowInsert(
  key: string,
  now = Date.now(),
): void {
  const keyTime = uuidV7TimestampMillis(key);
  if (keyTime === null) {
    guardedRequestInvalid('Operation key must be a UUIDv7.');
  }
  const delta = keyTime - now;
  if (delta > ADMISSION_FUTURE_MS) {
    guardedRequestInvalid('Operation key timestamp is too far in the future.');
  }
  if (now - keyTime > ADMISSION_PAST_MS) {
    idempotencyKeyExpired('Operation key is outside the admission window.');
  }
}
