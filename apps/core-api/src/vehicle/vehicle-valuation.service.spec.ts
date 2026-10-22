import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  DisabledEurotaxAtVehicleValuationProvider,
  VEHICLE_VALUATION_PROVIDER,
  type VehicleValuationProvider,
} from './vehicle-valuation.provider.js';
import { FixtureVehicleValuationProvider } from './vehicle-valuation.fixture-provider.js';
import { VehicleValuationService } from './vehicle-valuation.service.js';
import type { CreateVehicleValuationDto } from './dto/vehicle-valuation.dto.js';
import { createValuationInputSha256 } from './vehicle-valuation.util.js';

const fixtures = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dirname,
      '../../test/fixtures/vehicle-nationalcode-valuation.fixtures.json',
    ),
    'utf8',
  ),
) as {
  cases: Record<
    string,
    {
      http?: {
        vehicleId: string;
        idempotencyKey: string;
        body: CreateVehicleValuationDto & { nationalCode?: string };
      };
      vehicle?: Record<string, unknown>;
      response: Record<string, unknown>;
      readOn?: string;
      stored?: { idempotencyKey: string; inputSha256: string };
      retry?: { idempotencyKey: string; inputSha256: string };
    }
  >;
};

function fixtureResponse(
  cases: Record<string, { response: Record<string, unknown> }>,
  caseKey: string,
) {
  const { httpStatus: _httpStatus, ...body } = cases[caseKey].response as Record<
    string,
    unknown
  > & { httpStatus?: number };
  return body;
}

describe('VehicleValuationService', () => {
  const tenantId = 'tenant-1';
  const userId = 'user-db-1';
  const now = new Date('2026-10-15T10:00:00.000Z');

  let service: VehicleValuationService;
  let prisma: {
    vehicle: { findFirst: jest.Mock };
    vehicleValuationSnapshot: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    tenantMember: { findFirst: jest.Mock };
  };
  let tenantContext: { getTenantId: jest.Mock; getAuthenticatedUser: jest.Mock };
  let siteContext: { getSiteId: jest.Mock };
  let provider: jest.Mocked<VehicleValuationProvider>;
  let fixtureProvider: FixtureVehicleValuationProvider;

  const baseVehicle = {
    id: '00000000-0000-4000-8000-000000000527',
    vin: 'WAUZZZSYNTH000527',
    typenschein_no: 'TS-SYNTH-527',
    national_code: '100527',
    first_registration_date: new Date('2021-03-15T00:00:00.000Z'),
    inventory_role: 'CUSTOMER',
    site_id: null,
  };

  beforeEach(async () => {
    fixtureProvider = new FixtureVehicleValuationProvider();
    provider = {
      isAvailable: jest.fn().mockReturnValue(true),
      quote: jest.fn((input, _signal) => fixtureProvider.quote(input)),
    };
    prisma = {
      vehicle: { findFirst: jest.fn() },
      vehicleValuationSnapshot: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId }),
      },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
    };
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'firebase-1' }),
    };
    siteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleValuationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: SiteContextService, useValue: siteContext },
        { provide: VEHICLE_VALUATION_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = module.get(VehicleValuationService);
  });

  function mockVehicle(overrides: Record<string, unknown> = {}) {
    prisma.vehicle.findFirst.mockResolvedValue({
      ...baseVehicle,
      ...overrides,
    });
  }

  it('quotes market value and stores one snapshot', async () => {
    const caseFix = fixtures.cases['quoted-market-value'];
    mockVehicle(caseFix.vehicle ?? {});
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue(null);
    prisma.vehicleValuationSnapshot.create.mockImplementation(({ data }) =>
      Promise.resolve({
        ...data,
        amount: { toFixed: () => String(data.amount) },
        provider_as_of: data.provider_as_of,
        requested_as_of: data.requested_as_of,
        createdAt: now,
      }),
    );

    const body = caseFix.http!.body as CreateVehicleValuationDto;
    const result = await service.createValuation(
      caseFix.http!.vehicleId,
      body,
      caseFix.http!.idempotencyKey,
      now,
    );

    expect(result.result).toBe('QUOTED');
    expect(result.amount).toBe('14850.00');
    expect(result.stale).toBe(false);
    expect(prisma.vehicleValuationSnapshot.create).toHaveBeenCalledTimes(1);
    expect(prisma.vehicleValuationSnapshot.create.mock.calls[0][0].data).toMatchObject({
      national_code: '100527',
      mileage_km: 84200,
    });
  });

  it('returns uncertain identity for vin-shaped national code', async () => {
    const caseFix = fixtures.cases['uncertain-identity-vin-shaped'];
    mockVehicle({
      id: caseFix.http!.vehicleId,
      vin: 'WAUZZZSYNTH000528',
      national_code: 'WAUZZZSYNTH000528',
      typenschein_no: null,
    });

    await expect(
      service.createValuation(
        caseFix.http!.vehicleId,
        caseFix.http!.body,
        caseFix.http!.idempotencyKey,
        now,
      ),
    ).rejects.toMatchObject({
      response: fixtureResponse(fixtures.cases, 'uncertain-identity-vin-shaped'),
    });

    expect(provider.quote).not.toHaveBeenCalled();
    expect(prisma.vehicleValuationSnapshot.create).not.toHaveBeenCalled();
  });

  it('returns uncertain identity when national code equals typenschein', async () => {
    const caseFix = fixtures.cases['uncertain-identity-equals-typenschein'];
    mockVehicle({
      id: caseFix.http!.vehicleId,
      national_code: '100529',
      typenschein_no: '100529',
      vin: null,
    });

    await expect(
      service.createValuation(
        caseFix.http!.vehicleId,
        caseFix.http!.body,
        caseFix.http!.idempotencyKey,
        now,
      ),
    ).rejects.toMatchObject({
      response: { result: 'UNCERTAIN_IDENTITY' },
    });
  });

  it('returns missing data when mileage is omitted', async () => {
    const caseFix = fixtures.cases['missing-mileage'];
    mockVehicle(caseFix.vehicle ?? {});

    await expect(
      service.createValuation(
        caseFix.http!.vehicleId,
        caseFix.http!.body,
        caseFix.http!.idempotencyKey,
        now,
      ),
    ).rejects.toMatchObject({
      response: { result: 'MISSING_DATA', missing: ['mileageKm'] },
    });
  });

  it('returns ambiguous variant without storing', async () => {
    const caseFix = fixtures.cases['ambiguous-variant'];
    mockVehicle({
      id: caseFix.http!.vehicleId,
      national_code: '100530',
    });
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue(null);

    await expect(
      service.createValuation(
        caseFix.http!.vehicleId,
        caseFix.http!.body,
        caseFix.http!.idempotencyKey,
        now,
      ),
    ).rejects.toMatchObject({
      response: fixtureResponse(fixtures.cases, 'ambiguous-variant'),
    });

    expect(prisma.vehicleValuationSnapshot.create).not.toHaveBeenCalled();
  });

  it('stores poor quote without first registration', async () => {
    const caseFix = fixtures.cases['quoted-poor-without-first-registration'];
    mockVehicle({
      id: caseFix.http!.vehicleId,
      national_code: '100531',
      first_registration_date: null,
    });
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue(null);
    prisma.vehicleValuationSnapshot.create.mockImplementation(({ data }) =>
      Promise.resolve({
        ...data,
        amount: { toFixed: () => String(data.amount) },
        provider_as_of: data.provider_as_of,
        requested_as_of: data.requested_as_of,
        createdAt: now,
      }),
    );

    const result = await service.createValuation(
      caseFix.http!.vehicleId,
      caseFix.http!.body,
      caseFix.http!.idempotencyKey,
      now,
    );

    expect(result.amount).toBe('4200.00');
    expect(result.condition).toBe('POOR');
  });

  it('lists valuations with stale flag on read', async () => {
    const readOn = new Date(`${fixtures.cases['stale-valuation'].readOn}T12:00:00.000Z`);
    mockVehicle({ id: baseVehicle.id });
    prisma.vehicleValuationSnapshot.findMany.mockResolvedValue([
      {
        id: 'snap-1',
        national_code: '100527',
        mileage_km: 84200,
        condition: 'ROADWORTHY_AVERAGE',
        amount: { toFixed: () => '15100.00', },
        reference_version: 'synthetic-ref-2026-09',
        contract_version: 'acp-valuation-contract-1',
        provider_as_of: new Date('2026-10-01T00:00:00.000Z'),
        requested_as_of: new Date('2026-10-01T00:00:00.000Z'),
        createdAt: readOn,
      },
    ]);

    const rows = await service.listValuations(baseVehicle.id, readOn);
    expect(rows[0]).toMatchObject(
      fixtureResponse(fixtures.cases, 'stale-valuation'),
    );
    expect(provider.quote).not.toHaveBeenCalled();
  });

  it('returns conflict replay for mismatched idempotency input', async () => {
    const caseFix = fixtures.cases['conflict-replay'];
    mockVehicle(baseVehicle);
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue({
      idempotency_key: caseFix.stored!.idempotencyKey,
      input_sha256: caseFix.stored!.inputSha256,
    });

    await expect(
      service.createValuation(
        baseVehicle.id,
        fixtures.cases['quoted-market-value'].http!.body,
        caseFix.retry!.idempotencyKey,
        now,
      ),
    ).rejects.toMatchObject({
      response: { result: 'CONFLICT_REPLAY' },
    });
  });

  it('replays stored quote for the same idempotency key and input hash', async () => {
    const body = fixtures.cases['quoted-market-value'].http!
      .body as CreateVehicleValuationDto;
    const inputSha256 = createValuationInputSha256({
      vehicleId: baseVehicle.id,
      nationalCode: '100527',
      valuationType: 'MARKET_VALUE',
      mileageKm: body.mileageKm!,
      condition: body.condition!,
      requestedAsOf: body.requestedAsOf!,
      currency: 'EUR',
      contractVersion: 'acp-valuation-contract-1',
    });
    mockVehicle(baseVehicle);
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue({
      id: 'existing-snap',
      national_code: '100527',
      mileage_km: 84200,
      condition: 'ROADWORTHY_AVERAGE',
      amount: { toFixed: () => '14850.00' },
      reference_version: 'synthetic-ref-2026-10',
      contract_version: 'acp-valuation-contract-1',
      provider_as_of: new Date('2026-10-15T00:00:00.000Z'),
      requested_as_of: new Date('2026-10-15T00:00:00.000Z'),
      input_sha256: inputSha256,
      createdAt: now,
    });

    const result = await service.createValuation(
      baseVehicle.id,
      body,
      fixtures.cases['quoted-market-value'].http!.idempotencyKey,
      now,
    );

    expect(result.id).toBe('existing-snap');
    expect(prisma.vehicleValuationSnapshot.create).not.toHaveBeenCalled();
  });

  it('returns reference version unknown without storing', async () => {
    mockVehicle({ national_code: '100532' });
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue(null);

    await expect(
      service.createValuation(
        baseVehicle.id,
        fixtures.cases['quoted-market-value'].http!.body,
        'synthetic-ref-unknown',
        now,
      ),
    ).rejects.toMatchObject({
      response: fixtureResponse(fixtures.cases, 'reference-version-unknown'),
    });
    expect(prisma.vehicleValuationSnapshot.create).not.toHaveBeenCalled();
  });

  it('returns as-of unknown without storing', async () => {
    mockVehicle({ national_code: '100533' });
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue(null);

    await expect(
      service.createValuation(
        baseVehicle.id,
        fixtures.cases['quoted-market-value'].http!.body,
        'synthetic-asof-unknown',
        now,
      ),
    ).rejects.toMatchObject({
      response: fixtureResponse(fixtures.cases, 'as-of-unknown'),
    });
    expect(prisma.vehicleValuationSnapshot.create).not.toHaveBeenCalled();
  });

  it('rejects impossible requestedAsOf before calling the provider', async () => {
    mockVehicle(baseVehicle);
    prisma.vehicleValuationSnapshot.findFirst.mockResolvedValue(null);

    await expect(
      service.createValuation(
        baseVehicle.id,
        {
          ...fixtures.cases['quoted-market-value'].http!.body,
          requestedAsOf: '2026-02-29',
        },
        'invalid-date-key-1234567',
        now,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'VALUATION_REQUESTED_AS_OF_INVALID',
        field: 'requestedAsOf',
      },
    });
    expect(provider.quote).not.toHaveBeenCalled();
    expect(prisma.vehicleValuationSnapshot.create).not.toHaveBeenCalled();
  });

  it('replays after a unique-key race on insert', async () => {
    const body = fixtures.cases['quoted-market-value'].http!.body;
    const inputSha256 = createValuationInputSha256({
      vehicleId: baseVehicle.id,
      nationalCode: '100527',
      valuationType: 'MARKET_VALUE',
      mileageKm: body.mileageKm!,
      condition: body.condition!,
      requestedAsOf: body.requestedAsOf!,
      currency: 'EUR',
      contractVersion: 'acp-valuation-contract-1',
    });
    mockVehicle(baseVehicle);
    prisma.vehicleValuationSnapshot.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'raced-snap',
        national_code: '100527',
        mileage_km: 84200,
        condition: 'ROADWORTHY_AVERAGE',
        amount: { toFixed: () => '14850.00' },
        reference_version: 'synthetic-ref-2026-10',
        contract_version: 'acp-valuation-contract-1',
        provider_as_of: new Date('2026-10-15T00:00:00.000Z'),
        requested_as_of: new Date('2026-10-15T00:00:00.000Z'),
        input_sha256: inputSha256,
        createdAt: now,
      });
    prisma.vehicleValuationSnapshot.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.createValuation(
      baseVehicle.id,
      body,
      fixtures.cases['quoted-market-value'].http!.idempotencyKey,
      now,
    );

    expect(result.id).toBe('raced-snap');
  });

  it('returns 404 for stock vehicle on another site', async () => {
    mockVehicle({
      inventory_role: 'USED',
      site_id: 'other-site',
    });

    await expect(
      service.createValuation(
        baseVehicle.id,
        fixtures.cases['quoted-market-value'].http!.body,
        'site-mismatch-key-12345678',
        now,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VehicleValuationService with disabled production provider', () => {
  it('returns provider unavailable without I/O', async () => {
    const prisma = {
      vehicle: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000527',
          vin: 'WAUZZZSYNTH000527',
          typenschein_no: 'TS-SYNTH-527',
          national_code: '100527',
          first_registration_date: new Date('2021-03-15T00:00:00.000Z'),
          inventory_role: 'CUSTOMER',
          site_id: null,
        }),
      },
      vehicleValuationSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      tenantMember: { findFirst: jest.fn().mockResolvedValue({ id: 'm-1' }) },
    };
    const module = await Test.createTestingModule({
      providers: [
        VehicleValuationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TenantContextService,
          useValue: {
            getTenantId: jest.fn().mockResolvedValue('tenant-1'),
            getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'fb' }),
          },
        },
        { provide: SiteContextService, useValue: { getSiteId: jest.fn() } },
        {
          provide: VEHICLE_VALUATION_PROVIDER,
          useExisting: DisabledEurotaxAtVehicleValuationProvider,
        },
        DisabledEurotaxAtVehicleValuationProvider,
      ],
    }).compile();
    const service = module.get(VehicleValuationService);
    const body = fixtures.cases['quoted-market-value'].http!
      .body as CreateVehicleValuationDto;

    try {
      await service.createValuation(
        '00000000-0000-4000-8000-000000000527',
        body,
        'provider-down-key-123456',
        new Date('2026-10-15T10:00:00.000Z'),
      );
      throw new Error('expected ServiceUnavailableException');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject(
        fixtureResponse(fixtures.cases, 'provider-unavailable'),
      );
    }

    expect(prisma.vehicleValuationSnapshot.create).not.toHaveBeenCalled();
    expect(
      new DisabledEurotaxAtVehicleValuationProvider().isAvailable(),
    ).toBe(false);
  });
});
