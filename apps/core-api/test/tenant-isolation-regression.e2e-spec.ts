import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { normalizeVehicleMakeAlias } from '../src/catalog/vehicle-make-alias.util';
import {
  createTenantAwarePrisma,
  createTestTenant,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Tenant Isolation Regression (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAPrisma: PrismaService;
  let tenantBPrisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;

  const prefix = `e2e-tenant-iso-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const tenantA = await createTestTenant(prisma, `${prefix}-a`);
    const tenantB = await createTestTenant(prisma, `${prefix}-b`);

    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    tenantAPrisma = createTenantAwarePrisma(prisma, tenantAId);
    tenantBPrisma = createTenantAwarePrisma(prisma, tenantBId);
  });

  beforeEach(async () => {
    await tenantAPrisma.brand.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await tenantBPrisma.brand.deleteMany({
      where: { name: { startsWith: prefix } },
    });

    await tenantAPrisma.employee.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await tenantBPrisma.employee.deleteMany({
      where: { name: { startsWith: prefix } },
    });

    await tenantAPrisma.bay.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await tenantBPrisma.bay.deleteMany({
      where: { name: { startsWith: prefix } },
    });

    await tenantAPrisma.storageLocation.deleteMany({
      where: { code: { startsWith: `${prefix}-LOC` } },
    });
    await tenantBPrisma.storageLocation.deleteMany({
      where: { code: { startsWith: `${prefix}-LOC` } },
    });
  });

  afterAll(async () => {
    if (tenantAPrisma && tenantBPrisma) {
      await tenantAPrisma.brand.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantBPrisma.brand.deleteMany({
        where: { name: { startsWith: prefix } },
      });

      await tenantAPrisma.employee.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantBPrisma.employee.deleteMany({
        where: { name: { startsWith: prefix } },
      });

      await tenantAPrisma.bay.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantBPrisma.bay.deleteMany({
        where: { name: { startsWith: prefix } },
      });

      await tenantAPrisma.storageLocation.deleteMany({
        where: { code: { startsWith: `${prefix}-LOC` } },
      });
      await tenantBPrisma.storageLocation.deleteMany({
        where: { code: { startsWith: `${prefix}-LOC` } },
      });
    }

    if (app) {
      await teardownTestApp(app, prisma);
    }
  });

  it('scopes findMany and count to the calling tenant even with overlapping data', async () => {
    const sharedName = `${prefix}-BRAND-SHARED`;

    const brandA = await tenantAPrisma.brand.create({
      data: {
        tenant_id: tenantAId,
        name: sharedName,
        normalized_name: normalizeVehicleMakeAlias(sharedName),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });

    const brandB = await tenantBPrisma.brand.create({
      data: {
        tenant_id: tenantBId,
        name: sharedName,
        normalized_name: normalizeVehicleMakeAlias(sharedName),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });

    const resultsA = await tenantAPrisma.brand.findMany({
      where: { name: sharedName },
    });
    const resultsB = await tenantBPrisma.brand.findMany({
      where: { name: sharedName },
    });

    expect(resultsA).toHaveLength(1);
    expect(resultsA[0].id).toBe(brandA.id);
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0].id).toBe(brandB.id);

    const countA = await tenantAPrisma.brand.count({
      where: { name: sharedName },
    });
    const countB = await tenantBPrisma.brand.count({
      where: { name: sharedName },
    });

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it('stamps tenant_id on create and prevents cross-tenant visibility', async () => {
    const created = await tenantAPrisma.brand.create({
      data: {
        tenant_id: tenantAId,
        name: `${prefix}-STAMPED`,
        normalized_name: normalizeVehicleMakeAlias(`${prefix}-STAMPED`),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });

    const createdForA = await tenantAPrisma.brand.findFirst({
      where: { id: created.id },
      select: { tenant_id: true },
    });
    const createdForB = await tenantBPrisma.brand.findFirst({
      where: { id: created.id },
      select: { id: true },
    });

    expect(createdForA?.tenant_id).toBe(tenantAId);
    expect(createdForB).toBeNull();
  });

  it('blocks cross-tenant updateMany and deleteMany mutations by id', async () => {
    const brandForTenantB = await tenantBPrisma.brand.create({
      data: {
        tenant_id: tenantBId,
        name: `${prefix}-B-ONLY`,
        normalized_name: normalizeVehicleMakeAlias(`${prefix}-B-ONLY`),
        isVehicleMake: false,
        isPartManufacturer: true,
      },
    });

    const updateAttempt = await tenantAPrisma.brand.updateMany({
      where: { id: brandForTenantB.id },
      data: { isVehicleMake: true },
    });

    const deleteAttempt = await tenantAPrisma.brand.deleteMany({
      where: { id: brandForTenantB.id },
    });

    expect(updateAttempt.count).toBe(0);
    expect(deleteAttempt.count).toBe(0);

    const stillExistsForB = await tenantBPrisma.brand.findFirst({
      where: { id: brandForTenantB.id },
      select: { id: true },
    });

    expect(stillExistsForB?.id).toBe(brandForTenantB.id);
  });

  it('keeps upsert isolated by tenant-scoped unique selector', async () => {
    const sharedCode = `${prefix}-LOC-001`;

    const upsertA = await tenantAPrisma.storageLocation.upsert({
      where: {
        tenant_id_code: {
          tenant_id: tenantAId,
          code: sharedCode,
        },
      },
      update: { name: `${prefix}-A-updated` },
      create: {
        tenant_id: tenantAId,
        code: sharedCode,
        name: `${prefix}-A-created`,
        type: 'warehouse',
      },
    });

    const upsertB = await tenantBPrisma.storageLocation.upsert({
      where: {
        tenant_id_code: {
          tenant_id: tenantBId,
          code: sharedCode,
        },
      },
      update: { name: `${prefix}-B-updated` },
      create: {
        tenant_id: tenantBId,
        code: sharedCode,
        name: `${prefix}-B-created`,
        type: 'warehouse',
      },
    });

    expect(upsertA.id).not.toBe(upsertB.id);

    const countA = await tenantAPrisma.storageLocation.count({
      where: { code: sharedCode },
    });
    const countB = await tenantBPrisma.storageLocation.count({
      where: { code: sharedCode },
    });

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it('scopes aggregate and groupBy to the calling tenant', async () => {
    await tenantAPrisma.brand.create({
      data: {
        tenant_id: tenantAId,
        name: `${prefix}-AGG-A-1`,
        normalized_name: normalizeVehicleMakeAlias(`${prefix}-AGG-A-1`),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    await tenantAPrisma.brand.create({
      data: {
        tenant_id: tenantAId,
        name: `${prefix}-AGG-A-2`,
        normalized_name: normalizeVehicleMakeAlias(`${prefix}-AGG-A-2`),
        isVehicleMake: false,
        isPartManufacturer: true,
      },
    });
    await tenantBPrisma.brand.create({
      data: {
        tenant_id: tenantBId,
        name: `${prefix}-AGG-B-1`,
        normalized_name: normalizeVehicleMakeAlias(`${prefix}-AGG-B-1`),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });

    const aggregateA = await tenantAPrisma.brand.aggregate({
      _count: { _all: true },
    });
    const aggregateB = await tenantBPrisma.brand.aggregate({
      _count: { _all: true },
    });

    expect(aggregateA._count._all).toBe(2);
    expect(aggregateB._count._all).toBe(1);

    const groupedA = await tenantAPrisma.brand.groupBy({
      by: ['isVehicleMake'],
      _count: { _all: true },
      orderBy: { isVehicleMake: 'asc' },
    });

    const totalGroupedA = groupedA.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    expect(totalGroupedA).toBe(2);
  });

  it('throws a developer-facing error on findUnique usage', async () => {
    await expect(
      tenantAPrisma.brand.findUnique({ where: { id: 1 } }),
    ).rejects.toThrow(/Do not use findUnique\(\)/);
  });

  it('scopes bays and employees to the current tenant for reads and writes', async () => {
    const sharedBayName = `${prefix}-BAY-SHARED`;
    const sharedEmployeeName = `${prefix}-EMP-SHARED`;

    const bayA = await tenantAPrisma.bay.create({
      data: {
        name: sharedBayName,
        is_active: true,
        sort_order: 1,
      },
    });
    const bayB = await tenantBPrisma.bay.create({
      data: {
        name: sharedBayName,
        is_active: true,
        sort_order: 1,
      },
    });

    const employeeA = await tenantAPrisma.employee.create({
      data: {
        name: sharedEmployeeName,
        role: 'MECHANIC',
        is_active: true,
        sort_order: 1,
      },
    });
    const employeeB = await tenantBPrisma.employee.create({
      data: {
        name: sharedEmployeeName,
        role: 'MECHANIC',
        is_active: true,
        sort_order: 1,
      },
    });

    const baysForTenantA = await tenantAPrisma.bay.findMany({
      where: { name: sharedBayName },
    });
    const baysForTenantB = await tenantBPrisma.bay.findMany({
      where: { name: sharedBayName },
    });

    expect(baysForTenantA).toHaveLength(1);
    expect(baysForTenantA[0].id).toBe(bayA.id);
    expect(baysForTenantB).toHaveLength(1);
    expect(baysForTenantB[0].id).toBe(bayB.id);

    const employeesForTenantA = await tenantAPrisma.employee.findMany({
      where: { name: sharedEmployeeName },
    });
    const employeesForTenantB = await tenantBPrisma.employee.findMany({
      where: { name: sharedEmployeeName },
    });

    expect(employeesForTenantA).toHaveLength(1);
    expect(employeesForTenantA[0].id).toBe(employeeA.id);
    expect(employeesForTenantB).toHaveLength(1);
    expect(employeesForTenantB[0].id).toBe(employeeB.id);

    await expect(
      tenantAPrisma.bay.update({
        where: { id: bayB.id },
        data: { sort_order: 9 },
      }),
    ).rejects.toThrow();

    await expect(
      tenantAPrisma.employee.delete({
        where: { id: employeeB.id },
      }),
    ).rejects.toThrow();
  });
});
