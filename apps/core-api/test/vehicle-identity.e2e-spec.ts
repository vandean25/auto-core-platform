import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { createGlobalValidationPipe } from '../src/common';
import {
  SandboxVehicleIdentityProvider,
  VEHICLE_IDENTITY_PROVIDER,
  type VehicleIdentityProvider,
  type VehicleIdentityProviderInput,
} from '../src/vehicle/vehicle-identity.provider';
import { createIdentityInputFingerprint } from '../src/vehicle/vehicle-identity.util';
import { normalizeVehicleMakeAlias } from '../src/catalog/vehicle-make-alias.util';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

const INVALID_POWER_KW_FOR_INT_COLUMN = 2_147_483_648;

const VEHICLE_IDENTITY_FIELDS_CLEARED = {
  make_brand_id: null,
  hsn: null,
  tsn: null,
  identity_keys: null,
  identity_input_fingerprint: null,
  identity_resolved_at: null,
};

const SUCCESSFUL_UNKNOWN_MAKE = 'Created Unknown Sandbox Motors';
const SUCCESSFUL_UNKNOWN_VIN = 'UNKNOWNCREATEAUT23100001';

async function snapshotVehicleIdentityRows(
  prisma: PrismaService,
  tenantId: string,
) {
  const [brands, aliases, concerns, concernMakes, vehicles] = await Promise.all(
    [
      prisma.brand.findMany({
        where: { tenant_id: tenantId },
        orderBy: { id: 'asc' },
      }),
      prisma.vehicleMakeAlias.findMany({
        where: { tenant_id: tenantId },
        orderBy: { id: 'asc' },
      }),
      prisma.catalogOemConcern.findMany({
        where: { tenant_id: tenantId },
        orderBy: { id: 'asc' },
      }),
      prisma.catalogOemConcernMake.findMany({
        where: { tenant_id: tenantId },
        orderBy: { id: 'asc' },
      }),
      prisma.vehicle.findMany({
        where: { tenant_id: tenantId },
        orderBy: { id: 'asc' },
      }),
    ],
  );

  return { brands, aliases, concerns, concernMakes, vehicles };
}

describe('Vehicle identity resolution (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let otherPrisma: PrismaService;
  let otherTenantId: string;
  let otherAuthToken: string;
  let techAuthToken: string;
  const providerInputs: VehicleIdentityProviderInput[] = [];

  beforeAll(async () => {
    const sandboxProvider = new SandboxVehicleIdentityProvider();
    const testProvider: VehicleIdentityProvider = {
      resolve: async (input) => {
        providerInputs.push({ ...input });
        const resolved = await sandboxProvider.resolve(input);

        if (input.vin === 'WVWROLLBACK123') {
          return {
            ...resolved,
            make: 'Rollback Sandbox Motors',
            power_kw: INVALID_POWER_KW_FOR_INT_COLUMN,
          };
        }

        if (
          input.vin === 'VF1AUT231000002A' ||
          input.vin === 'VF1AUT231000002B'
        ) {
          return { ...resolved, make: 'Peugeot SA' };
        }

        if (
          input.vin === 'VF1AUT231000002C' ||
          input.vin === 'VF1AUT231000002D'
        ) {
          return { ...resolved, make: 'Peugeot' };
        }

        if (input.vin === SUCCESSFUL_UNKNOWN_VIN) {
          return { ...resolved, make: SUCCESSFUL_UNKNOWN_MAKE };
        }

        if (input.vin.startsWith('UNKNOWN')) {
          return { ...resolved, make: 'Unknown Sandbox Motors' };
        }

        return resolved;
      },
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VEHICLE_IDENTITY_PROVIDER)
      .useValue(testProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'vehicle-identity');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const otherTenant = await createTestTenant(
      basePrisma,
      'vehicle-identity-other',
    );
    otherTenantId = otherTenant.tenantId;
    otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
    otherAuthToken = createTestAuthToken(app.get(AuthService), otherTenant);

    await runWithTenantContext(tenantId, async () => {
      const techFirebaseUid = `e2e-tech-vehicle-identity-${randomUUID()}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techFirebaseUid,
          email: `${techFirebaseUid}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      techAuthToken = app.get(AuthService).createTestToken({
        sub: techFirebaseUid,
        email: techUser.email,
        tenantId,
        role: 'TECH',
      });
    });
  });

  beforeEach(() => {
    providerInputs.length = 0;
  });

  afterAll(async () => {
    try {
      if (basePrisma && tenantId) {
        await cleanupTestTenantGraph(basePrisma, tenantId);
      }
    } finally {
      try {
        if (basePrisma && otherTenantId) {
          await cleanupTestTenantGraph(basePrisma, otherTenantId);
        }
      } finally {
        if (app) {
          await teardownTestApp(app, basePrisma);
        }
      }
    }
  });

  it('resolves a VF VIN through sandbox and persists identity metadata', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Before resolution',
        model: 'Before resolution',
        year: 2020,
        vin: 'VF1AUT231000001',
        plate: ' w-231-aut ',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: vehicle.id,
      make: 'Peugeot',
      model: 'Sandbox Model',
      year: 2024,
      identity_keys: { vin: 'VF1AUT231000001' },
    });
    expect(response.body.make_brand_id).toEqual(expect.any(Number));
    expect(response.body.identity_input_fingerprint).toBe(
      createIdentityInputFingerprint(' vf1aut231000001 ', ' w-231-aut '),
    );
    expect(response.body.identity_input_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.identity_resolved_at).toEqual(expect.any(String));
    expect(providerInputs).toContainEqual({
      vin: 'VF1AUT231000001',
      plate: 'W-231-AUT',
    });

    const persisted = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicle.id },
    });
    expect(persisted).toMatchObject({
      id: vehicle.id,
      make: 'Peugeot',
      model: 'Sandbox Model',
      identity_keys: { vin: 'VF1AUT231000001' },
      identity_input_fingerprint: response.body.identity_input_fingerprint,
    });
    expect(persisted?.make_brand_id).toBe(response.body.make_brand_id);
    expect(persisted?.identity_resolved_at).toBeInstanceOf(Date);
  });

  it('routes Peugeot through each tenant alias to its configured OEM concern', async () => {
    const tenantBrand = await prisma.brand.upsert({
      where: {
        tenant_id_name: { tenant_id: tenantId, name: 'Peugeot' },
      },
      update: { isVehicleMake: true, isPartManufacturer: false },
      create: {
        tenant_id: tenantId,
        name: 'Peugeot',
        normalized_name: normalizeVehicleMakeAlias('Peugeot'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    const otherBrand = await otherPrisma.brand.upsert({
      where: {
        tenant_id_name: { tenant_id: otherTenantId, name: 'Peugeot' },
      },
      update: { isVehicleMake: true, isPartManufacturer: false },
      create: {
        tenant_id: otherTenantId,
        name: 'Peugeot',
        normalized_name: normalizeVehicleMakeAlias('Peugeot'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });

    await prisma.vehicleMakeAlias.upsert({
      where: {
        tenant_id_alias_normalized: {
          tenant_id: tenantId,
          alias_normalized: 'PEUGEOTSA',
        },
      },
      update: { brand_id: tenantBrand.id },
      create: {
        tenant_id: tenantId,
        alias_normalized: 'PEUGEOTSA',
        brand_id: tenantBrand.id,
      },
    });
    await otherPrisma.vehicleMakeAlias.upsert({
      where: {
        tenant_id_alias_normalized: {
          tenant_id: otherTenantId,
          alias_normalized: 'PEUGEOTSA',
        },
      },
      update: { brand_id: otherBrand.id },
      create: {
        tenant_id: otherTenantId,
        alias_normalized: 'PEUGEOTSA',
        brand_id: otherBrand.id,
      },
    });
    const tenantConcern = await prisma.catalogOemConcern.upsert({
      where: {
        tenant_id_code: { tenant_id: tenantId, code: 'STELLANTIS' },
      },
      update: {},
      create: { tenant_id: tenantId, code: 'STELLANTIS' },
    });
    const otherConcern = await otherPrisma.catalogOemConcern.upsert({
      where: {
        tenant_id_code: { tenant_id: otherTenantId, code: 'STELLANTIS' },
      },
      update: {},
      create: { tenant_id: otherTenantId, code: 'STELLANTIS' },
    });
    await prisma.catalogOemConcernMake.upsert({
      where: {
        tenant_id_brand_id: { tenant_id: tenantId, brand_id: tenantBrand.id },
      },
      update: { concern_id: tenantConcern.id },
      create: {
        tenant_id: tenantId,
        concern_id: tenantConcern.id,
        brand_id: tenantBrand.id,
      },
    });
    await otherPrisma.catalogOemConcernMake.upsert({
      where: {
        tenant_id_brand_id: {
          tenant_id: otherTenantId,
          brand_id: otherBrand.id,
        },
      },
      update: { concern_id: otherConcern.id },
      create: {
        tenant_id: otherTenantId,
        concern_id: otherConcern.id,
        brand_id: otherBrand.id,
      },
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: 'VF1AUT231000002A',
      },
    });
    const otherVehicle = await otherPrisma.vehicle.create({
      data: {
        tenant_id: otherTenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: 'VF1AUT231000002B',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const otherResponse = await request(app.getHttpServer())
      .post(`/api/vehicles/${otherVehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(200);

    expect(response.body.make_brand_id).toBe(tenantBrand.id);
    expect(otherResponse.body.make_brand_id).toBe(otherBrand.id);
    expect(response.body.make).toBe('Peugeot SA');
    expect(otherResponse.body.make).toBe('Peugeot SA');
    expect(tenantBrand.id).not.toBe(otherBrand.id);
    expect(tenantBrand.tenant_id).toBe(tenantId);
    expect(otherBrand.tenant_id).toBe(otherTenantId);
    expect(tenantBrand.name).toBe('Peugeot');
    expect(otherBrand.name).toBe('Peugeot');

    const persistedVehicle = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicle.id },
    });
    const persistedOtherVehicle = await otherPrisma.vehicle.findFirst({
      where: { tenant_id: otherTenantId, id: otherVehicle.id },
    });
    expect(persistedVehicle).toMatchObject({
      make: 'Peugeot SA',
      make_brand_id: tenantBrand.id,
    });
    expect(persistedOtherVehicle).toMatchObject({
      make: 'Peugeot SA',
      make_brand_id: otherBrand.id,
    });

    const tenantConcernMake = await prisma.catalogOemConcernMake.findFirst({
      where: {
        tenant_id: tenantId,
        brand_id: tenantBrand.id,
        concern_id: tenantConcern.id,
      },
    });
    const otherConcernMake = await otherPrisma.catalogOemConcernMake.findFirst({
      where: {
        tenant_id: otherTenantId,
        brand_id: otherBrand.id,
        concern_id: otherConcern.id,
      },
    });
    expect(tenantConcernMake).toMatchObject({
      tenant_id: tenantId,
      brand_id: tenantBrand.id,
      concern_id: tenantConcern.id,
    });
    expect(otherConcernMake).toMatchObject({
      tenant_id: otherTenantId,
      brand_id: otherBrand.id,
      concern_id: otherConcern.id,
    });
  });

  it('does not attach a tenant-B Brand through a tenant-A alias', async () => {
    const tenantBrand = await prisma.brand.upsert({
      where: {
        tenant_id_name: { tenant_id: tenantId, name: 'Peugeot' },
      },
      update: { isVehicleMake: true, isPartManufacturer: false },
      create: {
        tenant_id: tenantId,
        name: 'Peugeot',
        normalized_name: normalizeVehicleMakeAlias('Peugeot'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    const otherBrand = await otherPrisma.brand.upsert({
      where: {
        tenant_id_name: { tenant_id: otherTenantId, name: 'Peugeot' },
      },
      update: { isVehicleMake: true, isPartManufacturer: false },
      create: {
        tenant_id: otherTenantId,
        name: 'Peugeot',
        normalized_name: normalizeVehicleMakeAlias('Peugeot'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    const tenantConcern = await prisma.catalogOemConcern.upsert({
      where: {
        tenant_id_code: { tenant_id: tenantId, code: 'STELLANTIS' },
      },
      update: {},
      create: { tenant_id: tenantId, code: 'STELLANTIS' },
    });
    const otherConcern = await otherPrisma.catalogOemConcern.upsert({
      where: {
        tenant_id_code: { tenant_id: otherTenantId, code: 'STELLANTIS' },
      },
      update: {},
      create: { tenant_id: otherTenantId, code: 'STELLANTIS' },
    });

    await prisma.vehicleMakeAlias.upsert({
      where: {
        tenant_id_alias_normalized: {
          tenant_id: tenantId,
          alias_normalized: 'PUG',
        },
      },
      update: { brand_id: tenantBrand.id },
      create: {
        tenant_id: tenantId,
        alias_normalized: 'PUG',
        brand_id: tenantBrand.id,
      },
    });
    await prisma.vehicleMakeAlias.upsert({
      where: {
        tenant_id_alias_normalized: {
          tenant_id: tenantId,
          alias_normalized: 'PEUGEOT',
        },
      },
      update: { brand_id: otherBrand.id },
      create: {
        tenant_id: tenantId,
        alias_normalized: 'PEUGEOT',
        brand_id: otherBrand.id,
      },
    });
    await otherPrisma.vehicleMakeAlias.upsert({
      where: {
        tenant_id_alias_normalized: {
          tenant_id: otherTenantId,
          alias_normalized: 'PEUGEOT',
        },
      },
      update: { brand_id: otherBrand.id },
      create: {
        tenant_id: otherTenantId,
        alias_normalized: 'PEUGEOT',
        brand_id: otherBrand.id,
      },
    });
    await prisma.catalogOemConcernMake.upsert({
      where: {
        tenant_id_brand_id: { tenant_id: tenantId, brand_id: tenantBrand.id },
      },
      update: { concern_id: tenantConcern.id },
      create: {
        tenant_id: tenantId,
        concern_id: tenantConcern.id,
        brand_id: tenantBrand.id,
      },
    });
    await otherPrisma.catalogOemConcernMake.upsert({
      where: {
        tenant_id_brand_id: {
          tenant_id: otherTenantId,
          brand_id: otherBrand.id,
        },
      },
      update: { concern_id: otherConcern.id },
      create: {
        tenant_id: otherTenantId,
        concern_id: otherConcern.id,
        brand_id: otherBrand.id,
      },
    });

    const tenantAVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: 'VF1AUT231000002C',
      },
    });
    const tenantBVehicle = await otherPrisma.vehicle.create({
      data: {
        tenant_id: otherTenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: 'VF1AUT231000002D',
      },
    });

    const tenantAResponse = await request(app.getHttpServer())
      .post(`/api/vehicles/${tenantAVehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const tenantBResponse = await request(app.getHttpServer())
      .post(`/api/vehicles/${tenantBVehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(200);

    expect(tenantAResponse.body.make_brand_id).toBe(tenantBrand.id);
    expect(tenantBResponse.body.make_brand_id).toBe(otherBrand.id);
    expect(tenantAResponse.body.make_brand_id).not.toBe(otherBrand.id);

    const [
      persistedTenantAVehicle,
      persistedTenantBVehicle,
      tenantBrands,
      otherBrands,
      tenantAliases,
      otherPeugeotAlias,
      tenantConcerns,
      otherConcerns,
      tenantConcernMakes,
      otherConcernMakes,
    ] = await Promise.all([
      prisma.vehicle.findFirst({
        where: { tenant_id: tenantId, id: tenantAVehicle.id },
      }),
      otherPrisma.vehicle.findFirst({
        where: { tenant_id: otherTenantId, id: tenantBVehicle.id },
      }),
      prisma.brand.findMany({
        where: { tenant_id: tenantId, id: tenantBrand.id },
      }),
      otherPrisma.brand.findMany({
        where: { tenant_id: otherTenantId, id: otherBrand.id },
      }),
      prisma.vehicleMakeAlias.findMany({
        where: { tenant_id: tenantId },
      }),
      otherPrisma.vehicleMakeAlias.findFirst({
        where: {
          tenant_id: otherTenantId,
          alias_normalized: 'PEUGEOT',
        },
      }),
      prisma.catalogOemConcern.findMany({
        where: { tenant_id: tenantId, id: tenantConcern.id },
      }),
      otherPrisma.catalogOemConcern.findMany({
        where: { tenant_id: otherTenantId, id: otherConcern.id },
      }),
      prisma.catalogOemConcernMake.findMany({
        where: { tenant_id: tenantId },
      }),
      otherPrisma.catalogOemConcernMake.findMany({
        where: { tenant_id: otherTenantId },
      }),
    ]);

    expect(persistedTenantAVehicle?.make_brand_id).toBe(tenantBrand.id);
    expect(persistedTenantBVehicle?.make_brand_id).toBe(otherBrand.id);
    expect(tenantBrands).toEqual([
      expect.objectContaining({
        id: tenantBrand.id,
        tenant_id: tenantId,
        name: 'Peugeot',
      }),
    ]);
    expect(otherBrands).toEqual([
      expect.objectContaining({
        id: otherBrand.id,
        tenant_id: otherTenantId,
        name: 'Peugeot',
      }),
    ]);
    expect(tenantAliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: tenantId,
          alias_normalized: 'PUG',
          brand_id: tenantBrand.id,
        }),
        expect.objectContaining({
          tenant_id: tenantId,
          alias_normalized: 'PEUGEOT',
          brand_id: otherBrand.id,
        }),
      ]),
    );
    expect(otherPeugeotAlias).toEqual(
      expect.objectContaining({
        tenant_id: otherTenantId,
        alias_normalized: 'PEUGEOT',
        brand_id: otherBrand.id,
      }),
    );
    expect(tenantConcerns).toEqual([
      expect.objectContaining({
        id: tenantConcern.id,
        tenant_id: tenantId,
        code: 'STELLANTIS',
      }),
    ]);
    expect(otherConcerns).toEqual([
      expect.objectContaining({
        id: otherConcern.id,
        tenant_id: otherTenantId,
        code: 'STELLANTIS',
      }),
    ]);
    expect(tenantConcernMakes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: tenantId,
          concern_id: tenantConcern.id,
          brand_id: tenantBrand.id,
        }),
      ]),
    );
    expect(tenantConcernMakes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: tenantId,
          brand_id: otherBrand.id,
        }),
      ]),
    );
    expect(otherConcernMakes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: otherTenantId,
          concern_id: otherConcern.id,
          brand_id: otherBrand.id,
        }),
      ]),
    );
  });

  it('clears identity fields when a plate changes', async () => {
    const brand = await prisma.brand.upsert({
      where: {
        tenant_id_name: { tenant_id: tenantId, name: 'Reset Brand' },
      },
      update: { isVehicleMake: true, isPartManufacturer: false },
      create: {
        tenant_id: tenantId,
        name: 'Reset Brand',
        normalized_name: normalizeVehicleMakeAlias('Reset Brand'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    const resolvedAt = new Date('2026-08-29T10:00:00.000Z');
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Resolved make',
        model: 'Resolved model',
        year: 2024,
        vin: 'PATCHAUT23100001',
        plate: 'OLD-PLATE',
        make_brand_id: brand.id,
        hsn: '1234',
        tsn: '567',
        identity_keys: { vin: 'PATCHAUT23100001' },
        identity_input_fingerprint: 'a'.repeat(64),
        identity_resolved_at: resolvedAt,
      },
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ plate: 'NEW-PLATE' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: vehicle.id,
      plate: 'NEW-PLATE',
      make_brand_id: null,
      hsn: null,
      tsn: null,
      identity_keys: null,
      identity_input_fingerprint: null,
      identity_resolved_at: null,
    });

    const persisted = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicle.id },
    });
    expect(persisted).toMatchObject({
      plate: 'NEW-PLATE',
      make_brand_id: null,
      hsn: null,
      tsn: null,
      identity_keys: null,
      identity_input_fingerprint: null,
      identity_resolved_at: null,
    });
  });

  it('clears identity fields when a VIN changes', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: ' vf1aut231000006 ',
        plate: 'VIN-CHANGE-PLATE',
      },
    });

    const resolved = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(resolved.body).toMatchObject({
      make_brand_id: expect.any(Number),
      identity_keys: { vin: 'VF1AUT231000006' },
      identity_input_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      identity_resolved_at: expect.any(String),
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ vin: 'VF1AUT231000007' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: vehicle.id,
      vin: 'VF1AUT231000007',
      ...VEHICLE_IDENTITY_FIELDS_CLEARED,
    });

    const persisted = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicle.id },
    });
    expect(persisted).toMatchObject({
      vin: 'VF1AUT231000007',
      ...VEHICLE_IDENTITY_FIELDS_CLEARED,
    });
  });

  it('returns a provider error for a FAIL VIN and clears stale identity fields', async () => {
    const brand = await prisma.brand.create({
      data: {
        tenant_id: tenantId,
        name: 'FAIL stale Brand',
        normalized_name: normalizeVehicleMakeAlias('FAIL stale Brand'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    const resolvedAt = new Date('2026-08-29T11:00:00.000Z');
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Stale make',
        model: 'Stale model',
        year: 2023,
        vin: 'FAILAUT231000003',
        plate: 'FAIL-PLATE',
        make_brand_id: brand.id,
        hsn: 'STALE-HSN',
        tsn: 'STALE-TSN',
        identity_keys: { vin: 'FAILAUT231000003' },
        identity_input_fingerprint: 'c'.repeat(64),
        identity_resolved_at: resolvedAt,
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(502);

    expect(response.body.message).toBe('Sandbox identity resolution failed');

    const persisted = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicle.id },
    });
    expect(persisted).toMatchObject({
      make_brand_id: null,
      hsn: null,
      tsn: null,
      identity_keys: null,
      identity_input_fingerprint: null,
      identity_resolved_at: null,
    });
  });

  it('rejects a TECH token from resolving vehicle identity', async () => {
    await request(app.getHttpServer())
      .post(
        '/api/vehicles/00000000-0000-4000-8000-000000000001/resolve-identity',
      )
      .set('Authorization', `Bearer ${techAuthToken}`)
      .expect(403);
  });

  it('rejects a tenant A vehicle with a tenant B token without changing either tenant', async () => {
    const tenantAVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Tenant A make',
        model: 'Tenant A model',
        year: 2020,
        vin: 'VF1AUT231000004',
      },
    });
    const tenantBVehicle = await otherPrisma.vehicle.create({
      data: {
        tenant_id: otherTenantId,
        make: 'Tenant B make',
        model: 'Tenant B model',
        year: 2020,
        vin: 'WVW AUT231000005'.replace(' ', ''),
      },
    });
    const tenantASnapshotBefore = await snapshotVehicleIdentityRows(
      prisma,
      tenantId,
    );
    const tenantBSnapshotBefore = await snapshotVehicleIdentityRows(
      otherPrisma,
      otherTenantId,
    );

    await request(app.getHttpServer())
      .post(`/api/vehicles/${tenantAVehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);

    expect(providerInputs).toHaveLength(0);
    const tenantASnapshotAfter = await snapshotVehicleIdentityRows(
      prisma,
      tenantId,
    );
    const tenantBSnapshotAfter = await snapshotVehicleIdentityRows(
      otherPrisma,
      otherTenantId,
    );

    expect(tenantASnapshotAfter).toEqual(tenantASnapshotBefore);
    expect(tenantBSnapshotAfter).toEqual(tenantBSnapshotBefore);
  });

  it('creates and attaches a Brand for a successful unique unknown make', async () => {
    const existingBrand = await prisma.brand.findFirst({
      where: {
        tenant_id: tenantId,
        name: SUCCESSFUL_UNKNOWN_MAKE,
        normalized_name: normalizeVehicleMakeAlias(SUCCESSFUL_UNKNOWN_MAKE),
        isVehicleMake: true,
      },
    });
    expect(existingBrand).toBeNull();

    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: SUCCESSFUL_UNKNOWN_VIN,
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.make).toBe(SUCCESSFUL_UNKNOWN_MAKE);
    const createdBrand = await prisma.brand.findFirst({
      where: {
        tenant_id: tenantId,
        name: SUCCESSFUL_UNKNOWN_MAKE,
        isVehicleMake: true,
      },
    });
    expect(createdBrand).toMatchObject({
      tenant_id: tenantId,
      name: SUCCESSFUL_UNKNOWN_MAKE,
      isVehicleMake: true,
      isPartManufacturer: false,
    });
    expect(response.body.make_brand_id).toBe(createdBrand?.id);

    const persistedVehicle = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicle.id },
    });
    expect(persistedVehicle?.make_brand_id).toBe(createdBrand?.id);
  });

  it('matches an unknown sandbox make to only the current tenant Brand', async () => {
    const tenantBrand = await prisma.brand.upsert({
      where: {
        tenant_id_name: {
          tenant_id: tenantId,
          name: 'Unknown Sandbox Motors',
        },
      },
      update: { isVehicleMake: true, isPartManufacturer: false },
      create: {
        tenant_id: tenantId,
        name: 'Unknown Sandbox Motors',
        normalized_name: normalizeVehicleMakeAlias('Unknown Sandbox Motors'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    const otherBrand = await otherPrisma.brand.upsert({
      where: {
        tenant_id_name: {
          tenant_id: otherTenantId,
          name: 'Unknown Sandbox Motors',
        },
      },
      update: { isVehicleMake: true, isPartManufacturer: false },
      create: {
        tenant_id: otherTenantId,
        name: 'Unknown Sandbox Motors',
        normalized_name: normalizeVehicleMakeAlias('Unknown Sandbox Motors'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });

    await prisma.catalogOemConcern.upsert({
      where: {
        tenant_id_code: { tenant_id: tenantId, code: 'STELLANTIS' },
      },
      update: {},
      create: { tenant_id: tenantId, code: 'STELLANTIS' },
    });
    await otherPrisma.catalogOemConcern.upsert({
      where: {
        tenant_id_code: { tenant_id: otherTenantId, code: 'STELLANTIS' },
      },
      update: {},
      create: { tenant_id: otherTenantId, code: 'STELLANTIS' },
    });

    const firstVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: 'UNKNOWNAUT23100001',
      },
    });
    const secondVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: 'UNKNOWNAUT23100002',
      },
    });
    const otherVehicle = await otherPrisma.vehicle.create({
      data: {
        tenant_id: otherTenantId,
        make: 'Pending make',
        model: 'Pending model',
        year: 2020,
        vin: 'UNKNOWNB23100001',
      },
    });

    const firstResponse = await request(app.getHttpServer())
      .post(`/api/vehicles/${firstVehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const secondResponse = await request(app.getHttpServer())
      .post(`/api/vehicles/${secondVehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const otherResponse = await request(app.getHttpServer())
      .post(`/api/vehicles/${otherVehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(200);

    expect(firstResponse.body.make).toBe('Unknown Sandbox Motors');
    expect(firstResponse.body.make_brand_id).toBe(tenantBrand.id);
    expect(secondResponse.body.make_brand_id).toBe(tenantBrand.id);
    expect(otherResponse.body.make_brand_id).toBe(otherBrand.id);
    expect(tenantBrand.id).not.toBe(otherBrand.id);

    const unknownBrands = await prisma.brand.findMany({
      where: {
        tenant_id: tenantId,
        name: 'Unknown Sandbox Motors',
        isVehicleMake: true,
      },
    });
    const otherUnknownBrands = await otherPrisma.brand.findMany({
      where: {
        tenant_id: otherTenantId,
        name: 'Unknown Sandbox Motors',
        isVehicleMake: true,
      },
    });
    expect(unknownBrands).toHaveLength(1);
    expect(otherUnknownBrands).toHaveLength(1);
    expect(unknownBrands[0]).toMatchObject({
      isVehicleMake: true,
      isPartManufacturer: false,
    });
    expect(otherUnknownBrands[0]).toMatchObject({
      isVehicleMake: true,
      isPartManufacturer: false,
    });
    expect(unknownBrands[0].id).toBe(tenantBrand.id);
    expect(otherUnknownBrands[0].id).toBe(otherBrand.id);

    const persistedFirstVehicle = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: firstVehicle.id },
    });
    const persistedOtherVehicle = await otherPrisma.vehicle.findFirst({
      where: { tenant_id: otherTenantId, id: otherVehicle.id },
    });
    expect(persistedFirstVehicle?.make_brand_id).toBe(tenantBrand.id);
    expect(persistedOtherVehicle?.make_brand_id).toBe(otherBrand.id);

    await expect(
      prisma.catalogOemConcernMake.findFirst({
        where: {
          tenant_id: tenantId,
          brand_id: unknownBrands[0].id,
        },
      }),
    ).resolves.toBeNull();
    await expect(
      otherPrisma.brand.findFirst({
        where: {
          tenant_id: otherTenantId,
          name: 'Unknown Sandbox Motors',
        },
      }),
    ).resolves.toEqual(otherBrand);
    await expect(
      otherPrisma.catalogOemConcernMake.findFirst({
        where: {
          tenant_id: otherTenantId,
          brand_id: otherUnknownBrands[0].id,
        },
      }),
    ).resolves.toBeNull();
  });

  it('rolls back an unknown-make Brand when the vehicle update fails', async () => {
    const originalBrand = await prisma.brand.create({
      data: {
        tenant_id: tenantId,
        name: 'Original rollback make',
        normalized_name: normalizeVehicleMakeAlias('Original rollback make'),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    const rollbackMake = 'Rollback Sandbox Motors';
    const existingRollbackBrand = await prisma.brand.findFirst({
      where: { tenant_id: tenantId, name: rollbackMake },
    });
    expect(existingRollbackBrand).toBeNull();

    const resolvedAt = new Date('2026-08-29T12:00:00.000Z');
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Original rollback make',
        model: 'Original rollback model',
        year: 2019,
        vin: 'WVWROLLBACK123',
        plate: 'ROLLBACK-PLATE',
        engine_code: 'ORIGINAL-ENGINE',
        make_brand_id: originalBrand.id,
        hsn: 'ORIGINAL-HSN',
        tsn: 'ORIGINAL-TSN',
        identity_keys: { vin: 'WVWROLLBACK123', source: 'original' },
        identity_input_fingerprint: 'b'.repeat(64),
        identity_resolved_at: resolvedAt,
        fuel_type: 'DIESEL',
        power_kw: 88,
      },
    });
    const originalVehicleFields = {
      id: vehicle.id,
      tenant_id: tenantId,
      createdAt: vehicle.createdAt,
      make: 'Original rollback make',
      model: 'Original rollback model',
      year: 2019,
      engine_code: 'ORIGINAL-ENGINE',
      vin: 'WVWROLLBACK123',
      plate: 'ROLLBACK-PLATE',
      fuel_type: 'DIESEL',
      power_kw: 88,
      customer_id: null,
      inventory_role: 'CUSTOMER',
      stock_status: null,
      tax_scheme: null,
      mileage: null,
      color: null,
      key_number: null,
      registration_certificate_no: null,
      location_id: null,
      reserved_for_customer_id: null,
    };

    await expect(
      prisma.vehicle.findFirst({
        where: { tenant_id: tenantId, id: vehicle.id },
      }),
    ).resolves.toMatchObject(originalVehicleFields);

    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/resolve-identity`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(500);

    const persistedVehicle = await prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicle.id },
    });
    expect(persistedVehicle).toMatchObject({
      ...originalVehicleFields,
      ...VEHICLE_IDENTITY_FIELDS_CLEARED,
    });

    const createdBrand = await prisma.brand.findFirst({
      where: { tenant_id: tenantId, name: rollbackMake },
    });

    expect(createdBrand).toBeNull();
  });
});
