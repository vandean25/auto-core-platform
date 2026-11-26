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

export class InvalidDomainEventConsumerTaskSignatureError extends Error {
  constructor() {
    super('Invalid domain event consumer task signature');
    this.name = 'InvalidDomainEventConsumerTaskSignatureError';
  }
}

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

function signaturesMatch(expected: string, actual: unknown): boolean {
  if (
    typeof actual !== 'string' ||
    actual.length !== expected.length ||
    !/^[0-9a-f]+$/i.test(actual)
  ) {
    return false;
  }
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
  record: unknown,
  secret: string,
): DomainEventConsumerTaskClaims {
  if (!record || typeof record !== 'object') {
    throw new InvalidDomainEventConsumerTaskSignatureError();
  }
  const { tenantId, consumerKey, signature } = record as Record<
    string,
    unknown
  >;
  if (typeof tenantId !== 'string' || typeof consumerKey !== 'string') {
    throw new InvalidDomainEventConsumerTaskSignatureError();
  }
  const claims: DomainEventConsumerTaskClaims = { tenantId, consumerKey };
  if (!signaturesMatch(hmacHex(claims, secret), signature)) {
    throw new InvalidDomainEventConsumerTaskSignatureError();
  }
  return claims;
}
