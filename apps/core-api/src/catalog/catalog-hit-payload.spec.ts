import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import {
  CATALOG_HIT_TTL_SECONDS,
  getCatalogHitSecret,
  signCatalogHitPayload,
  verifyCatalogHitPayload,
  type CatalogHitPayloadClaims,
} from './catalog-hit-payload';

describe('catalog-hit-payload', () => {
  const baseClaims = {
    tenantId: randomUUID(),
    workshopOrderId: randomUUID(),
    vehicleId: randomUUID(),
    taskId: randomUUID(),
    concern: 'PARTS' as const,
    sourceSystem: 'stellantis',
    externalId: 'part-1',
    name: 'Brake pad',
    articleNumber: 'BP-001',
    unitPrice: 99.5,
    brandLabel: 'STELLANTIS',
  };

  it('signs and verifies a catalog hit token', () => {
    const token = signCatalogHitPayload(baseClaims);
    const claims = verifyCatalogHitPayload(token);

    expect(claims.tenantId).toBe(baseClaims.tenantId);
    expect(claims.taskId).toBe(baseClaims.taskId);
    expect(claims.articleNumber).toBe(baseClaims.articleNumber);
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects tampered tokens', () => {
    const token = signCatalogHitPayload(baseClaims);
    const parsed = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as CatalogHitPayloadClaims & { signature: string };
    parsed.unitPrice = 1;
    const tampered = Buffer.from(JSON.stringify(parsed)).toString('base64url');

    expect(() => verifyCatalogHitPayload(tampered)).toThrow(
      'Invalid catalog hit token signature',
    );
  });

  it('rejects expired tokens', () => {
    const payload: CatalogHitPayloadClaims = {
      ...baseClaims,
      jti: randomUUID(),
      exp: Math.floor(Date.now() / 1000) - 1,
    };
    const secret = getCatalogHitSecret();
    const signature = createHmac('sha256', secret)
      .update(
        JSON.stringify({
          tenantId: payload.tenantId,
          workshopOrderId: payload.workshopOrderId,
          vehicleId: payload.vehicleId,
          taskId: payload.taskId,
          concern: payload.concern,
          sourceSystem: payload.sourceSystem,
          externalId: payload.externalId,
          jti: payload.jti,
          exp: payload.exp,
          name: payload.name,
          articleNumber: payload.articleNumber,
          unitPrice: payload.unitPrice,
          brandLabel: payload.brandLabel,
          ean: null,
          unit: null,
          fitmentNotes: null,
          costPriceEst: null,
          oemNumbers: null,
          externalOperationCode: null,
          standardAw: null,
          plannedHours: null,
        }),
      )
      .digest('hex');
    const token = Buffer.from(
      JSON.stringify({ ...payload, signature }),
    ).toString('base64url');

    expect(() => verifyCatalogHitPayload(token)).toThrow(
      'Catalog hit token expired',
    );
  });

  it('uses a TTL of at most 15 minutes', () => {
    const token = signCatalogHitPayload(baseClaims);
    const claims = verifyCatalogHitPayload(token);
    const ttl = claims.exp - Math.floor(Date.now() / 1000);

    expect(ttl).toBeLessThanOrEqual(CATALOG_HIT_TTL_SECONDS);
    expect(ttl).toBeGreaterThan(CATALOG_HIT_TTL_SECONDS - 5);
  });

  it('rejects tokens with injected unsigned fields', () => {
    const token = signCatalogHitPayload(baseClaims);
    const parsed = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as CatalogHitPayloadClaims & { signature: string; injectedTenantId?: string };
    parsed.injectedTenantId = randomUUID();
    const tampered = Buffer.from(JSON.stringify(parsed)).toString('base64url');

    const claims = verifyCatalogHitPayload(tampered);
    expect(claims.tenantId).toBe(baseClaims.tenantId);
    expect(claims).not.toHaveProperty('injectedTenantId');
  });

  it('rejects incomplete part claims after signature verification', () => {
    const token = signCatalogHitPayload({
      ...baseClaims,
      articleNumber: undefined,
    });

    expect(() => verifyCatalogHitPayload(token)).toThrow(
      'Incomplete catalog hit token',
    );
  });

  it('accepts a labor claim with an explicitly zero planned duration', () => {
    const token = signCatalogHitPayload({
      ...baseClaims,
      concern: 'LABOR',
      externalOperationCode: 'LABOR-1',
      standardAw: null,
      plannedHours: 0,
    });

    expect(verifyCatalogHitPayload(token).plannedHours).toBe(0);
  });

  it.each([
    ['unitPrice', { unitPrice: -0.01 }],
    ['costPriceEst', { costPriceEst: -0.01 }],
    [
      'standardAw',
      { concern: 'LABOR' as const, externalOperationCode: 'LABOR-1', standardAw: -1 },
    ],
    [
      'plannedHours',
      {
        concern: 'LABOR' as const,
        externalOperationCode: 'LABOR-1',
        plannedHours: -0.1,
      },
    ],
  ])('rejects a negative %s claim', (_field, overrides) => {
    const token = signCatalogHitPayload({
      ...baseClaims,
      ...overrides,
    });

    expect(() => verifyCatalogHitPayload(token)).toThrow(
      'Invalid catalog hit token',
    );
  });

  it('accepts a zero part price', () => {
    const token = signCatalogHitPayload({
      ...baseClaims,
      unitPrice: 0,
    });

    expect(verifyCatalogHitPayload(token).unitPrice).toBe(0);
  });
});
