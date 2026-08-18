import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

export const PDF_TASK_KINDS = ['invoice', 'workshop-order'] as const;
export type PdfTaskKind = (typeof PDF_TASK_KINDS)[number];
export const PDF_TASK_KIND_KEY = 'pdfTaskKind';

export type PdfTaskClaims = {
  kind: PdfTaskKind;
  resourceId: string;
  tenantId: string;
};

export type SignedPdfTaskPayload = PdfTaskClaims & {
  signature: string;
};

function isPdfTaskKind(value: string): value is PdfTaskKind {
  return (PDF_TASK_KINDS as readonly string[]).includes(value);
}

function canonicalString(claims: PdfTaskClaims): string {
  return `${claims.kind}:${claims.resourceId}:${claims.tenantId}`;
}

function hmacSignature(claims: PdfTaskClaims, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalString(claims))
    .digest('hex');
}

function signaturesMatch(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length === 0 || expected.length !== provided.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, provided);
}

export function signPdfTaskPayload(
  claims: PdfTaskClaims,
  secret: string,
): SignedPdfTaskPayload {
  return {
    ...claims,
    signature: hmacSignature(claims, secret),
  };
}

export function verifyPdfTaskPayload(
  payload: unknown,
  secret: string,
): PdfTaskClaims {
  if (!payload || typeof payload !== 'object') {
    throw new UnauthorizedException('Invalid PDF task payload');
  }

  const record = payload as Record<string, unknown>;
  const kind = record.kind;
  const resourceId = record.resourceId;
  const tenantId = record.tenantId;
  const signature = record.signature;

  if (
    typeof kind !== 'string' ||
    !isPdfTaskKind(kind) ||
    typeof resourceId !== 'string' ||
    resourceId.length === 0 ||
    typeof tenantId !== 'string' ||
    tenantId.length === 0 ||
    typeof signature !== 'string' ||
    signature.length === 0
  ) {
    throw new UnauthorizedException('Invalid PDF task payload');
  }

  const claims: PdfTaskClaims = { kind, resourceId, tenantId };
  const expected = hmacSignature(claims, secret);
  if (!signaturesMatch(expected, signature)) {
    throw new UnauthorizedException('Invalid PDF task payload signature');
  }

  return claims;
}
