import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const CATALOG_HIT_TTL_SECONDS = 15 * 60;

export type CatalogHitConcern = 'PARTS' | 'LABOR';

export type CatalogHitPayloadClaims = {
  tenantId: string;
  workshopOrderId: string;
  vehicleId: string;
  concern: CatalogHitConcern;
  sourceSystem: string;
  externalId: string;
  jti: string;
  exp: number;
  name: string;
  articleNumber?: string;
  unitPrice?: number;
  brandLabel?: string;
  ean?: string | null;
  unit?: string | null;
  fitmentNotes?: string | null;
  costPriceEst?: number | null;
  oemNumbers?: string[];
  externalOperationCode?: string;
  standardAw?: number | null;
  plannedHours?: number | null;
};

function canonicalString(claims: CatalogHitPayloadClaims): string {
  return JSON.stringify({
    tenantId: claims.tenantId,
    workshopOrderId: claims.workshopOrderId,
    vehicleId: claims.vehicleId,
    concern: claims.concern,
    sourceSystem: claims.sourceSystem,
    externalId: claims.externalId,
    jti: claims.jti,
    exp: claims.exp,
    name: claims.name,
    articleNumber: claims.articleNumber ?? null,
    unitPrice: claims.unitPrice ?? null,
    brandLabel: claims.brandLabel ?? null,
    ean: claims.ean ?? null,
    unit: claims.unit ?? null,
    fitmentNotes: claims.fitmentNotes ?? null,
    costPriceEst: claims.costPriceEst ?? null,
    oemNumbers: claims.oemNumbers ?? null,
    externalOperationCode: claims.externalOperationCode ?? null,
    standardAw: claims.standardAw ?? null,
    plannedHours: claims.plannedHours ?? null,
  });
}

function hmacSignature(
  claims: CatalogHitPayloadClaims,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(canonicalString(claims))
    .digest('hex');
}

function signaturesMatch(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length === 0 || expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

export function getCatalogHitSecret(): string {
  return (
    process.env.CATALOG_HIT_HMAC_SECRET ??
    process.env.TEST_JWT_SECRET ??
    'catalog-hit-test-secret'
  );
}

export function signCatalogHitPayload(
  claims: Omit<CatalogHitPayloadClaims, 'jti' | 'exp'>,
  secret = getCatalogHitSecret(),
): string {
  const payload: CatalogHitPayloadClaims = {
    ...claims,
    jti: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + CATALOG_HIT_TTL_SECONDS,
  };

  return Buffer.from(
    JSON.stringify({
      ...payload,
      signature: hmacSignature(payload, secret),
    }),
  ).toString('base64url');
}

export function verifyCatalogHitPayload(
  token: string,
  secret = getCatalogHitSecret(),
): CatalogHitPayloadClaims {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid catalog hit token');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid catalog hit token');
  }

  const record = parsed as Record<string, unknown>;
  const signature = record.signature;
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('Invalid catalog hit token signature');
  }

  const claims = { ...record } as CatalogHitPayloadClaims & {
    signature?: string;
  };
  delete claims.signature;

  const expected = hmacSignature(claims, secret);
  if (!signaturesMatch(expected, signature)) {
    throw new Error('Invalid catalog hit token signature');
  }

  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Catalog hit token expired');
  }

  return claims;
}
