import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { calculateNova } from '../src/nova-calculator/calculate-nova.js';
import { resolveTariffVersion } from '../src/nova-calculator/tariff-table.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Vehicle NoVA calculation (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantAPrisma: PrismaService;
  let authHeaderA: string;
  let vehicleIdA: string;
  let vehicleIdB: string;
  let vehicleIdWithoutCo2: string;
  let unparkedDealerVehicleId: string;
  let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const authService = app.get(AuthService);
    tenantA = await createTestTenant(basePrisma, 'e2e-nova-a');
    tenantB = await createTestTenant(basePrisma, 'e2e-nova-b');
    tenantAPrisma = createTenantAwarePrisma(basePrisma, tenantA.tenantId);
    const tenantBPrisma = createTenantAwarePrisma(basePrisma, tenantB.tenantId);
    authHeaderA = `Bearer ${createTestAuthToken(authService, tenantA)}`;
    const mainSiteId = await resolveTestMainSiteId(basePrisma, tenantA.tenantId);

    const vehicleA = await tenantAPrisma.vehicle.create({
      data: {
        make: 'Example',
        model: 'Preview A',
        year: 2024,
        vin: 'NOVA-E2E-VEHICLE-A',
        first_registration_date: new Date('2025-03-01T00:00:00.000Z'),
        co2_wltp_g_km: 165,
        co2_nedc_g_km: 130,
        fuel_type: 'PETROL',
        power_kw: 90,
        nova_class: 'STANDARD',
      },
    });
    vehicleIdA = vehicleA.id;

    const vehicleWithoutCo2 = await tenantAPrisma.vehicle.create({
      data: {
        make: 'Example',
        model: 'Preview without emissions',
        year: 2024,
        vin: 'NOVA-E2E-VEHICLE-NO-CO2',
        fuel_type: 'PETROL',
        nova_class: 'STANDARD',
      },
    });
    vehicleIdWithoutCo2 = vehicleWithoutCo2.id;

    const unparkedDealerVehicle = await tenantAPrisma.vehicle.create({
      data: {
        make: 'Example',
        model: 'Unparked dealer vehicle',
        year: 2024,
        vin: 'NOVA-E2E-UNPARKED-DEALER',
        inventory_role: 'USED',
        stock_status: 'IN_STOCK',
        site_id: mainSiteId,
        co2_wltp_g_km: 165,
        fuel_type: 'PETROL',
      },
    });
    unparkedDealerVehicleId = unparkedDealerVehicle.id;

    const vehicleB = await tenantBPrisma.vehicle.create({
      data: {
        make: 'Example',
        model: 'Preview B',
        year: 2024,
        vin: 'NOVA-E2E-VEHICLE-B',
        fuel_type: 'PETROL',
        nova_class: 'STANDARD',
      },
    });
    vehicleIdB = vehicleB.id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantA.tenantId);
    await cleanupTestTenantGraph(basePrisma, tenantB.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  it('returns the pure engine result for explicit inputs', async () => {
    const input = {
      co2GramsPerKm: 165,
      emissionCycle: 'WLTP' as const,
      netPriceEuro: 30_000,
      driveType: 'ICE' as const,
      taxableEventDate: '2025-03-01',
      vehicleClass: 'passenger_z3' as const,
    };
    const tariff = resolveTariffVersion(input.vehicleClass, input.taxableEventDate)!;

    const response = await request(app.getHttpServer())
      .post('/api/vehicles/nova/calculate')
      .set('Authorization', authHeaderA)
      .send(input)
      .expect(200);

    expect(response.body).toEqual({
      ...calculateNova(input, tariff.id),
      hasUnverifiedRules: false,
    });
  });

  it('fills vehicle regulatory inputs and respects explicit overrides', async () => {
    const defaultResponse = await request(app.getHttpServer())
      .post('/api/vehicles/nova/calculate')
      .set('Authorization', authHeaderA)
      .send({ vehicleId: vehicleIdA, netPriceEuro: 20_000 })
      .expect(200);
    const defaultInput = {
      co2GramsPerKm: 165,
      emissionCycle: 'WLTP' as const,
      netPriceEuro: 20_000,
      driveType: 'ICE' as const,
      taxableEventDate: new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Vienna',
      }).format(new Date()),
      firstRegistrationDate: '2025-03-01',
      vehicleClass: 'passenger_z3' as const,
      ratedPowerKw: 90,
    };
    const defaultTariff = resolveTariffVersion(
      defaultInput.vehicleClass,
      defaultInput.taxableEventDate,
    )!;
    expect(defaultResponse.body).toEqual({
      ...calculateNova(defaultInput, defaultTariff.id),
      hasUnverifiedRules: false,
    });

    const overrideInput = {
      co2GramsPerKm: 140,
      emissionCycle: 'WLTP' as const,
      netPriceEuro: 20_000,
      driveType: 'PHEV' as const,
      taxableEventDate: '2025-03-01',
      firstRegistrationDate: '2025-03-01',
      vehicleClass: 'passenger_z3' as const,
      ratedPowerKw: 90,
    };
    const tariff = resolveTariffVersion(
      overrideInput.vehicleClass,
      overrideInput.taxableEventDate,
    )!;
    const overrideResponse = await request(app.getHttpServer())
      .post('/api/vehicles/nova/calculate')
      .set('Authorization', authHeaderA)
      .send({
        vehicleId: vehicleIdA,
        ...overrideInput,
      })
      .expect(200);

    expect(overrideResponse.body).toEqual({
      ...calculateNova(overrideInput, tariff.id),
      hasUnverifiedRules: false,
    });
  });

  it('returns 422 with MISSING_CO2 for a vehicle without emissions or a substitute', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/vehicles/nova/calculate')
      .set('Authorization', authHeaderA)
      .send({ vehicleId: vehicleIdWithoutCo2, netPriceEuro: 20_000 })
      .expect(422);

    expect(response.body.code).toBe('MISSING_CO2');
  });

  it('returns 404 when the vehicle belongs to another tenant', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/vehicles/nova/calculate')
      .set('Authorization', authHeaderA)
      .send({ vehicleId: vehicleIdB, netPriceEuro: 20_000 })
      .expect(404);

    expect(response.body.message).toBe('Vehicle not found');
  });

  it('returns 404 for a dealer vehicle that has no lot on the active site', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/vehicles/nova/calculate')
      .set('Authorization', authHeaderA)
      .send({ vehicleId: unparkedDealerVehicleId, netPriceEuro: 20_000 })
      .expect(404);

    expect(response.body.message).toBe('Vehicle not found');
  });
});
