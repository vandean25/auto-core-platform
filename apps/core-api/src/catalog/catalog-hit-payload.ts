import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const CATALOG_HIT_TTL_SECONDS = 15 * 60;

export type CatalogHitConcern = 'PARTS' | 'LABOR';

export type CatalogHitPayloadClaims = {
  tenantId: string;
  workshopOrderId: string;
  vehicleId: string;
  taskId: string;
  concern: CatalogHitConcern;
  sourceSystem: string;
  externalId: string;
  jti: string;
  exp: number;
  name: string;
  articleNumber?: string;
  unitPrice?: number;
  brandLabel?: string | null;
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
    taskId: claims.taskId,
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
  const configured = process.env.CATALOG_HIT_HMAC_SECRET?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === 'test') {
    return process.env.TEST_JWT_SECRET ?? 'catalog-hit-test-secret';
  }
  throw new Error('CATALOG_HIT_HMAC_SECRET is required');
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid catalog hit token');
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('Invalid catalog hit token');
  }
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid catalog hit token');
  }
  return readNonNegativeNumber(value);
}

function readOptionalNullableNumber(
  record: Record<string, unknown>,
  key: string,
) {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid catalog hit token');
  }
  return readNonNegativeNumber(value);
}

function readNonNegativeNumber(value: number): number {
  if (value < 0) {
    throw new Error('Invalid catalog hit token');
  }
  return value;
}

function readOptionalNullableString(
  record: Record<string, unknown>,
  key: string,
) {
  const value = record[key];
  if (value === null) {
    return null;
  }
  return readOptionalString(record, key);
}

function readOptionalStringArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('Invalid catalog hit token');
  }
  return value;
}

function parseSignedClaims(
  record: Record<string, unknown>,
): CatalogHitPayloadClaims {
  const concern = record.concern;
  if (concern !== 'PARTS' && concern !== 'LABOR') {
    throw new Error('Invalid catalog hit token');
  }

  const exp = record.exp;
  if (typeof exp !== 'number' || !Number.isInteger(exp)) {
    throw new Error('Invalid catalog hit token');
  }

  return {
    tenantId: readRequiredString(record, 'tenantId'),
    workshopOrderId: readRequiredString(record, 'workshopOrderId'),
    vehicleId: readRequiredString(record, 'vehicleId'),
    taskId: readRequiredString(record, 'taskId'),
    concern,
    sourceSystem: readRequiredString(record, 'sourceSystem'),
    externalId: readRequiredString(record, 'externalId'),
    jti: readRequiredString(record, 'jti'),
    exp,
    name: readRequiredString(record, 'name'),
    articleNumber: readOptionalString(record, 'articleNumber'),
    unitPrice: readOptionalNumber(record, 'unitPrice'),
    brandLabel: readOptionalNullableString(record, 'brandLabel'),
    ean: readOptionalNullableString(record, 'ean'),
    unit: readOptionalNullableString(record, 'unit'),
    fitmentNotes: readOptionalNullableString(record, 'fitmentNotes'),
    costPriceEst: readOptionalNullableNumber(record, 'costPriceEst'),
    oemNumbers: readOptionalStringArray(record, 'oemNumbers'),
    externalOperationCode: readOptionalString(record, 'externalOperationCode'),
    standardAw: readOptionalNullableNumber(record, 'standardAw'),
    plannedHours: readOptionalNullableNumber(record, 'plannedHours'),
  };
}

function assertCompleteClaims(claims: CatalogHitPayloadClaims): void {
  if (claims.concern === 'PARTS') {
    if (
      !claims.articleNumber?.trim() ||
      claims.unitPrice === undefined ||
      claims.unitPrice === null
    ) {
      throw new Error('Incomplete catalog hit token');
    }
    return;
  }

  if (!claims.externalOperationCode?.trim()) {
    throw new Error('Incomplete catalog hit token');
  }
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

  const claims = parseSignedClaims(record);
  const expected = hmacSignature(claims, secret);
  if (!signaturesMatch(expected, signature)) {
    throw new Error('Invalid catalog hit token signature');
  }

  assertCompleteClaims(claims);

  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Catalog hit token expired');
  }

  return claims;
}
