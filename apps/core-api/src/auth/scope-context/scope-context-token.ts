import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { SCOPE_CONTEXT_TOKEN_VERSION } from './scope-context.constants.js';
import { continuityDigestForSignIn } from './scope-context-continuity.js';
import { readScopeContextHmacSecrets } from './scope-context-secret.js';

export type ScopeContextPayload = {
  v: typeof SCOPE_CONTEXT_TOKEN_VERSION;
  sub: string;
  cd: string;
  tid: string;
  sid: string;
  se: string;
  ae: string;
  pv: string;
};

export type ScopeContextComponents = {
  principalSub: string;
  continuityDigest: string;
  tenantId: string;
  siteId: string;
  scopeEpoch: bigint;
  authorizationEpoch: bigint;
  policyVersion: string;
};

export type MintScopeContextInput = ScopeContextComponents;

function encodePayload(payload: ScopeContextPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(encoded: string): ScopeContextPayload {
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as ScopeContextPayload;
    if (parsed.v !== SCOPE_CONTEXT_TOKEN_VERSION) {
      throw new Error('Unsupported scope context version');
    }
    return parsed;
  } catch {
    throw new UnauthorizedException('Invalid scope context token.');
  }
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function mintScopeContextToken(input: MintScopeContextInput): string {
  const { current } = readScopeContextHmacSecrets();
  const payload: ScopeContextPayload = {
    v: SCOPE_CONTEXT_TOKEN_VERSION,
    sub: input.principalSub,
    cd: input.continuityDigest,
    tid: input.tenantId,
    sid: input.siteId,
    se: input.scopeEpoch.toString(),
    ae: input.authorizationEpoch.toString(),
    pv: input.policyVersion,
  };
  const encoded = encodePayload(payload);
  const signature = signPayload(encoded, current);
  return `${encoded}.${signature}`;
}

export function verifyScopeContextToken(token: string): ScopeContextComponents {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) {
    throw new UnauthorizedException('Invalid scope context token.');
  }

  const { current, previous } = readScopeContextHmacSecrets();
  const signatures = [signPayload(encoded, current)];
  if (previous) {
    signatures.push(signPayload(encoded, previous));
  }
  if (
    !signatures.some((expected) => timingSafeEqualString(expected, signature))
  ) {
    throw new UnauthorizedException('Invalid scope context token.');
  }

  const payload = decodePayload(encoded);
  return {
    principalSub: payload.sub,
    continuityDigest: payload.cd,
    tenantId: payload.tid,
    siteId: payload.sid,
    scopeEpoch: BigInt(payload.se),
    authorizationEpoch: BigInt(payload.ae),
    policyVersion: payload.pv,
  };
}

export function scopeContextDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function buildContinuityDigest(
  subject: string,
  authTimeSeconds: number,
): string {
  const { current } = readScopeContextHmacSecrets();
  return continuityDigestForSignIn(current, subject, authTimeSeconds);
}
