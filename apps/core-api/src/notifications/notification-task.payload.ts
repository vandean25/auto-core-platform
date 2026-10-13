import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';

export interface NotificationTaskClaims {
  outboxId: string;
  tenantId: string;
}

export type SignedNotificationTaskPayload = NotificationTaskClaims & {
  signature: string;
};

/** Prefix keeps a signature for one task kind from being replayed as another. */
const CONTEXT = 'notification-outbox';

function canonicalString(claims: NotificationTaskClaims): string {
  return `${CONTEXT}:${claims.outboxId}:${claims.tenantId}`;
}

function hmacHex(claims: NotificationTaskClaims, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalString(claims))
    .digest('hex');
}

function signaturesMatch(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  return (
    expected.length > 0 &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}

export function signNotificationTaskPayload(
  claims: NotificationTaskClaims,
  secret: string,
): SignedNotificationTaskPayload {
  return { ...claims, signature: hmacHex(claims, secret) };
}

export function verifyNotificationTaskPayload(
  payload: unknown,
  secret: string,
): NotificationTaskClaims {
  if (!payload || typeof payload !== 'object') {
    throw new UnauthorizedException('Invalid notification task payload');
  }
  const record = payload as Record<string, unknown>;
  const isNonEmpty = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;
  if (
    !isNonEmpty(record.outboxId) ||
    !isNonEmpty(record.tenantId) ||
    !isNonEmpty(record.signature)
  ) {
    throw new UnauthorizedException('Invalid notification task payload');
  }
  const claims: NotificationTaskClaims = {
    outboxId: record.outboxId,
    tenantId: record.tenantId,
  };
  if (!signaturesMatch(hmacHex(claims, secret), record.signature)) {
    throw new UnauthorizedException('Invalid notification task signature');
  }
  return claims;
}
