import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Test, TestingModule } from '@nestjs/testing';
import { createGlobalValidationPipe } from '../common/validation.pipe.js';
import { roundMoneyEuro } from './rounding.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { NovaCalculateRequestDto } from '../vehicle/dto/nova-calculate.dto.js';
import { NovaCalculationService } from '../vehicle/nova-calculation.service.js';

type FixtureCase = {
  id: string;
  harness: 'http-body' | 'service-with-synthetic-vehicle';
  request: Record<string, unknown>;
  expected: {
    httpStatus: number;
    body?: Record<string, unknown>;
    error?: { code: string; message: string };
    mustNot?: Record<string, unknown>;
    layer?: string;
  };
  syntheticVehicle?: Record<string, unknown>;
};

type FixtureFile = {
  cases: FixtureCase[];
};

// The fixture type marks body and error optional; the branches that read them always have one.
function requiredField<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('fixture case is missing an expected field');
  }
  return value;
}

const fixturePath = join(
  process.cwd(),
  '../../docs/internal/02-Feature-Specs/Vehicles/fixtures/nova-eu-used-import/cases.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureFile;

const MONEY_FIELDS = new Set([
  'novaAmountEuro',
  'baseAmountEuro',
  'malusGrossEuro',
  'deductionGrossEuro',
  'fixedBeforeDevelopmentEuro',
  'fixedAfterDevelopmentEuro',
]);

const validationPipe = createGlobalValidationPipe();

function roundMoneyDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => roundMoneyDeep(entry));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'number' && MONEY_FIELDS.has(key)) {
        out[key] = roundMoneyEuro(entry);
      } else {
        out[key] = roundMoneyDeep(entry);
      }
    }
    return out;
  }
  return value;
}

function pickExpectedShape(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(expected)) {
    if (
      key === 'intermediates' &&
      value &&
      typeof value === 'object' &&
      actual.intermediates &&
      typeof actual.intermediates === 'object'
    ) {
      const nested: Record<string, unknown> = {};
      for (const innerKey of Object.keys(value)) {
        nested[innerKey] = (actual.intermediates as Record<string, unknown>)[
          innerKey
        ];
      }
      picked.intermediates = nested;
    } else {
      picked[key] = actual[key];
    }
  }
  return picked;
}

function normalizeSuccessBody(body: Record<string, unknown>): Record<string, unknown> {
  const normalized = roundMoneyDeep(body) as Record<string, unknown>;
  if (normalized.intermediates && typeof normalized.intermediates === 'object') {
    const intermediates = normalized.intermediates as Record<string, unknown>;
    for (const key of [
      'baseAmountEuro',
      'malusGrossEuro',
      'deductionGrossEuro',
      'fixedBeforeDevelopmentEuro',
      'fixedAfterDevelopmentEuro',
    ]) {
      if (typeof intermediates[key] === 'number') {
        intermediates[key] = roundMoneyEuro(intermediates[key]);
      }
    }
  }
  if (typeof normalized.novaAmountEuro === 'number') {
    normalized.novaAmountEuro = roundMoneyEuro(normalized.novaAmountEuro);
  }
  return normalized;
}

function assertMustNot(
  actual: Record<string, unknown>,
  mustNot: Record<string, unknown>,
): void {
  for (const [field, forbidden] of Object.entries(mustNot)) {
    if (field === 'includeNovaAmountEuro') {
      if (forbidden) {
        expect(actual).not.toHaveProperty('novaAmountEuro');
      }
      continue;
    }
    const actualValue = actual[field];
    if (Array.isArray(forbidden)) {
      for (const candidate of forbidden) {
        if (Array.isArray(actualValue)) {
          expect(actualValue).not.toContain(candidate);
        } else {
          expect(actualValue).not.toEqual(candidate);
        }
      }
    }
  }
}

async function validateHttpBody(
  request: Record<string, unknown>,
): Promise<NovaCalculateRequestDto> {
  return validationPipe.transform(request, {
    type: 'body',
    metatype: NovaCalculateRequestDto,
  }) as Promise<NovaCalculateRequestDto>;
}

describe('nova-eu-used-import cases.json', () => {
  let service: NovaCalculationService;
  const prisma = { vehicle: { findFirst: jest.fn() } };
  const tenantContext = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
  const siteContext = { tryGetSite: jest.fn().mockResolvedValue({ id: 'site-1' }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NovaCalculationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: SiteContextService, useValue: siteContext },
      ],
    }).compile();
    service = module.get(NovaCalculationService);
  });

  describe.each(fixture.cases.map((caseRow) => [caseRow.id, caseRow] as const))(
    '%s',
    (_id, caseRow) => {
      it(`matches fixture expectation (${caseRow.harness})`, async () => {
        if (caseRow.harness === 'service-with-synthetic-vehicle') {
          const synthetic = caseRow.syntheticVehicle!;
          prisma.vehicle.findFirst.mockResolvedValue({
            first_registration_date: synthetic.first_registration_date
              ? new Date(`${synthetic.first_registration_date}T00:00:00.000Z`)
              : null,
            co2_wltp_g_km: synthetic.co2_wltp_g_km ?? null,
            co2_nedc_g_km: synthetic.co2_nedc_g_km ?? null,
            fuel_type: 'PETROL',
            power_kw: null,
            nova_class: synthetic.nova_class ?? null,
          });
        }

        if (caseRow.harness === 'http-body') {
          if (caseRow.expected.httpStatus === 400) {
            await expect(validateHttpBody(caseRow.request)).rejects.toBeDefined();
            if (caseRow.expected.mustNot) {
              assertMustNot({}, caseRow.expected.mustNot);
            }
            return;
          }

          const dto = await validateHttpBody(caseRow.request);
          expect(validateSync(dto)).toEqual([]);

          if (caseRow.expected.httpStatus === 422) {
            try {
              await service.calculate(dto);
              throw new Error('expected 422');
            } catch (error) {
              expect(error).toBeInstanceOf(UnprocessableEntityException);
              const response = (error as UnprocessableEntityException).getResponse() as Record<
                string,
                unknown
              >;
              expect(response).toMatchObject(requiredField(caseRow.expected.error));
              expect(response).not.toHaveProperty('novaAmountEuro');
              if (caseRow.expected.mustNot) {
                assertMustNot(response, caseRow.expected.mustNot);
              }
            }
            return;
          }

          const result = await service.calculate(dto);
          const actualBody = normalizeSuccessBody({ ...result });
          const expectedBody = normalizeSuccessBody(requiredField(caseRow.expected.body));
          expect(pickExpectedShape(actualBody, expectedBody)).toEqual(
            expectedBody,
          );
          if (caseRow.expected.mustNot) {
            assertMustNot(actualBody, caseRow.expected.mustNot);
          }
          return;
        }

        const run = () =>
          service.calculate(
            caseRow.request as Parameters<NovaCalculationService['calculate']>[0],
          );

        if (caseRow.expected.httpStatus === 422) {
          try {
            await run();
            throw new Error('expected 422');
          } catch (error) {
            expect(error).toBeInstanceOf(UnprocessableEntityException);
            const response = (error as UnprocessableEntityException).getResponse() as Record<
              string,
              unknown
            >;
            expect(response).toMatchObject(requiredField(caseRow.expected.error));
            expect(response).not.toHaveProperty('novaAmountEuro');
            if (caseRow.expected.mustNot) {
              assertMustNot(response, caseRow.expected.mustNot);
            }
          }
          return;
        }

        const result = await run();
        const actualBody = normalizeSuccessBody({ ...result });
        const expectedBody = normalizeSuccessBody(requiredField(caseRow.expected.body));
        expect(pickExpectedShape(actualBody, expectedBody)).toEqual(expectedBody);
        if (caseRow.expected.mustNot) {
          assertMustNot(actualBody, caseRow.expected.mustNot);
        }
      });
    },
  );
});

describe('eu_used_m1 originalNewNetEuro validation', () => {
  let service: NovaCalculationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NovaCalculationService,
        { provide: PrismaService, useValue: { vehicle: { findFirst: jest.fn() } } },
        {
          provide: TenantContextService,
          useValue: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
        },
        {
          provide: SiteContextService,
          useValue: { tryGetSite: jest.fn().mockResolvedValue({ id: 'site-1' }) },
        },
      ],
    }).compile();
    service = module.get(NovaCalculationService);
  });

  it('maps non-finite originalNewNetEuro to MISSING_ORIGINAL_NEW_NET', async () => {
    const dto = await validateHttpBody({
      importMode: 'eu_used_m1',
      vehicleClass: 'passenger_z3',
      driveType: 'ICE',
      emissionCycle: 'WLTP',
      co2GramsPerKm: 160,
      firstRegistrationDate: '2024-06-01',
      taxableEventDate: '2026-06-01',
      netPriceEuro: 20_000,
      valueBasis: 'known_new_net',
      originalNewNetEuro: Number.NaN,
    });

    await expect(service.calculate(dto)).rejects.toMatchObject({
      response: {
        code: 'MISSING_ORIGINAL_NEW_NET',
        message: 'known_new_net requires originalNewNetEuro greater than zero',
      },
    });
  });
});
