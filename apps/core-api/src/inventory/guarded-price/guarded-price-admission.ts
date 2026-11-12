import {
  guardedRequestInvalid,
  idempotencyKeyExpired,
} from './guarded-price.errors.js';
import { isUuidV7, uuidV7TimestampMillis } from './guarded-price.uuid.js';

export const GUARDED_PRICE_ADMISSION_PAST_MS = 24 * 60 * 60 * 1000;
export const GUARDED_PRICE_ADMISSION_FUTURE_MS = 5 * 60 * 1000;

const ADMISSION_PAST_MS = GUARDED_PRICE_ADMISSION_PAST_MS;
const ADMISSION_FUTURE_MS = GUARDED_PRICE_ADMISSION_FUTURE_MS;

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

export function assertKeyNotTooFarFuture(key: string, now = Date.now()): void {
  const keyTime = uuidV7TimestampMillis(key);
  if (keyTime === null) {
    guardedRequestInvalid('Operation key must be a UUIDv7.');
  }
  if (keyTime - now > ADMISSION_FUTURE_MS) {
    guardedRequestInvalid('Operation key timestamp is too far in the future.');
  }
}

export function isKeyInsideAdmissionWindow(
  key: string,
  now = Date.now(),
): boolean {
  const keyTime = uuidV7TimestampMillis(key);
  if (keyTime === null) {
    return false;
  }
  if (keyTime - now > ADMISSION_FUTURE_MS) {
    return false;
  }
  return now - keyTime <= ADMISSION_PAST_MS;
}

export function assertKeyAdmissionOnNoRowInsert(
  key: string,
  now = Date.now(),
): void {
  const keyTime = uuidV7TimestampMillis(key);
  if (keyTime === null) {
    guardedRequestInvalid('Operation key must be a UUIDv7.');
  }
  assertKeyNotTooFarFuture(key, now);
  if (now - keyTime > ADMISSION_PAST_MS) {
    idempotencyKeyExpired('Operation key is outside the admission window.');
  }
}
