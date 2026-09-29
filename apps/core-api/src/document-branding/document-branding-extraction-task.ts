import { UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type DocumentBrandingExtractionTaskClaims = {
  extractionId: string;
  legalEntityId: string;
  tenantId: string;
  expectedAttemptCount: number;
};

export type SignedDocumentBrandingExtractionTask =
  DocumentBrandingExtractionTaskClaims & { signature: string };

function canonicalClaims(claims: DocumentBrandingExtractionTaskClaims): string {
  return `document-branding-extraction:${claims.extractionId}:${claims.legalEntityId}:${claims.tenantId}:${claims.expectedAttemptCount}`;
}

export function signDocumentBrandingExtractionTask(
  claims: DocumentBrandingExtractionTaskClaims,
  secret: string,
): SignedDocumentBrandingExtractionTask {
  return {
    ...claims,
    signature: createHmac('sha256', secret)
      .update(canonicalClaims(claims))
      .digest('hex'),
  };
}

export function verifyDocumentBrandingExtractionTask(
  payload: unknown,
  secret: string,
): DocumentBrandingExtractionTaskClaims {
  if (!isTaskPayload(payload)) {
    throw new UnauthorizedException('Invalid document branding task payload');
  }
  const claims = {
    extractionId: payload.extractionId,
    legalEntityId: payload.legalEntityId,
    tenantId: payload.tenantId,
    expectedAttemptCount: payload.expectedAttemptCount,
  };
  const expected = Buffer.from(
    createHmac('sha256', secret).update(canonicalClaims(claims)).digest('hex'),
    'hex',
  );
  const provided = Buffer.from(payload.signature, 'hex');
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new UnauthorizedException('Invalid document branding task signature');
  }
  return claims;
}

function isTaskPayload(
  value: unknown,
): value is SignedDocumentBrandingExtractionTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record).sort();
  return (
    fields.length === 5 &&
    fields.join(',') ===
      'expectedAttemptCount,extractionId,legalEntityId,signature,tenantId' &&
    typeof record.extractionId === 'string' &&
    record.extractionId.length > 0 &&
    typeof record.legalEntityId === 'string' &&
    record.legalEntityId.length > 0 &&
    typeof record.tenantId === 'string' &&
    record.tenantId.length > 0 &&
    Number.isInteger(record.expectedAttemptCount) &&
    Number(record.expectedAttemptCount) >= 0 &&
    typeof record.signature === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.signature)
  );
}
