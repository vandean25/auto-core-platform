import { UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type DocumentBrandingUploadTaskClaims = {
  assetId: string;
  tenantId: string;
};

export type SignedDocumentBrandingUploadTask =
  DocumentBrandingUploadTaskClaims & { signature: string };

function canonicalClaims(claims: DocumentBrandingUploadTaskClaims) {
  return `document-branding-asset-validation:${claims.assetId}:${claims.tenantId}`;
}

export function signDocumentBrandingUploadTask(
  claims: DocumentBrandingUploadTaskClaims,
  secret: string,
): SignedDocumentBrandingUploadTask {
  return {
    ...claims,
    signature: createHmac('sha256', secret)
      .update(canonicalClaims(claims))
      .digest('hex'),
  };
}

export function verifyDocumentBrandingUploadTask(
  payload: unknown,
  secret: string,
): DocumentBrandingUploadTaskClaims {
  if (!payload || typeof payload !== 'object') {
    throw new UnauthorizedException('Invalid document branding task payload');
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.assetId !== 'string' ||
    !record.assetId ||
    typeof record.tenantId !== 'string' ||
    !record.tenantId ||
    typeof record.signature !== 'string'
  ) {
    throw new UnauthorizedException('Invalid document branding task payload');
  }

  const claims = { assetId: record.assetId, tenantId: record.tenantId };
  const expected = Buffer.from(
    createHmac('sha256', secret).update(canonicalClaims(claims)).digest('hex'),
    'hex',
  );
  const provided = Buffer.from(record.signature, 'hex');
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new UnauthorizedException('Invalid document branding task signature');
  }
  return claims;
}
