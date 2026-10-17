import { createHmac, timingSafeEqual } from 'node:crypto';

const CONTEXT = 'domain-event-consumer:v1';

export type DomainEventConsumerTaskClaims = {
  tenantId: string;
  consumerKey: string;
};

export type SignedDomainEventConsumerTaskPayload =
  DomainEventConsumerTaskClaims & {
    signature: string;
  };

function canonicalString(claims: DomainEventConsumerTaskClaims): string {
  return `${CONTEXT}:${claims.consumerKey}:${claims.tenantId}`;
}

function hmacHex(
  claims: DomainEventConsumerTaskClaims,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(canonicalString(claims))
    .digest('hex');
}

function signaturesMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function signDomainEventConsumerTaskPayload(
  claims: DomainEventConsumerTaskClaims,
  secret: string,
): SignedDomainEventConsumerTaskPayload {
  return { ...claims, signature: hmacHex(claims, secret) };
}

export function verifyDomainEventConsumerTaskPayload(
  record: SignedDomainEventConsumerTaskPayload,
  secret: string,
): DomainEventConsumerTaskClaims {
  const claims: DomainEventConsumerTaskClaims = {
    tenantId: record.tenantId,
    consumerKey: record.consumerKey,
  };
  if (!signaturesMatch(hmacHex(claims, secret), record.signature)) {
    throw new Error('Invalid domain event consumer task signature');
  }
  return claims;
}
