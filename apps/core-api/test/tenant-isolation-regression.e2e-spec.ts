import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { DryRunService } from '../src/dry-run/dry-run.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { normalizeVehicleMakeAlias } from '../src/catalog/vehicle-make-alias.util.js';
import {
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Tenant Isolation Regression (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAPrisma: PrismaService;
  let tenantBPrisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let adminHeaderA: string;
  let techHeaderA: string;

  const prefix = `e2e-tenant-iso-${Date.now()}`;

  function brandData(name: string) {
    return {
      name,
      normalized_name: normalizeVehicleMakeAlias(name),
      isVehicleMake: true,
      isPartManufacturer: false,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const tenantA = await createTestTenant(prisma, `${prefix}-a`);
    const tenantB = await createTestTenant(prisma, `${prefix}-b`);

    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    tenantAPrisma = createTenantAwarePrisma(prisma, tenantAId);
    tenantBPrisma = createTenantAwarePrisma(prisma, tenantBId);

    const authService = app.get(AuthService);
    adminHeaderA = `Bearer ${createTestAuthToken(authService, tenantA)}`;
    techHeaderA = await createMemberBearer(prisma, authService, tenantA, 'TECH');
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

    await tenantAPrisma.importJob.deleteMany({
      where: { file_name: { startsWith: `${prefix}-CONCURRENT` } },
    });
    await tenantBPrisma.importJob.deleteMany({
      where: { file_name: { startsWith: `${prefix}-CONCURRENT` } },
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

      await tenantAPrisma.importJob.deleteMany({
        where: { file_name: { startsWith: `${prefix}-CONCURRENT` } },
      });
      await tenantBPrisma.importJob.deleteMany({
        where: { file_name: { startsWith: `${prefix}-CONCURRENT` } },
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

    const siteA = await tenantAPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantAId, code: 'MAIN' },
    });
    const siteB = await tenantBPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantBId, code: 'MAIN' },
    });

    const upsertA = await tenantAPrisma.storageLocation.upsert({
      where: {
        tenant_id_site_id_code: {
          tenant_id: tenantAId,
          site_id: siteA.id,
          code: sharedCode,
        },
      },
      update: { name: `${prefix}-A-updated` },
      create: {
        tenant_id: tenantAId,
        site_id: siteA.id,
        code: sharedCode,
        name: `${prefix}-A-created`,
        type: 'warehouse',
      },
    });

    const upsertB = await tenantBPrisma.storageLocation.upsert({
      where: {
        tenant_id_site_id_code: {
          tenant_id: tenantBId,
          site_id: siteB.id,
          code: sharedCode,
        },
      },
      update: { name: `${prefix}-B-updated` },
      create: {
        tenant_id: tenantBId,
        site_id: siteB.id,
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

    const siteA = await tenantAPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantAId, code: 'MAIN' },
    });
    const siteB = await tenantBPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantBId, code: 'MAIN' },
    });

    const bayA = await tenantAPrisma.bay.create({
      data: {
        tenant_id: tenantAId,
        name: sharedBayName,
        is_active: true,
        sort_order: 1,
        site_id: siteA.id,
      },
    });
    const bayB = await tenantBPrisma.bay.create({
      data: {
        tenant_id: tenantBId,
        name: sharedBayName,
        is_active: true,
        sort_order: 1,
        site_id: siteB.id,
      },
    });

    const employeeA = await tenantAPrisma.employee.create({
      data: {
        tenant_id: tenantAId,
        name: sharedEmployeeName,
        role: 'MECHANIC',
        is_active: true,
        sort_order: 1,
      },
    });
    const employeeB = await tenantBPrisma.employee.create({
      data: {
        tenant_id: tenantBId,
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

  describe('id-scoped writes keep tenant ownership inside the write', () => {
    it('rejects a cross-tenant update and delete by id and leaves the row unchanged', async () => {
      const brandB = await tenantBPrisma.brand.create({
        data: { tenant_id: tenantBId, ...brandData(`${prefix}-CROSS-B`) },
      });

      await expect(
        tenantAPrisma.brand.update({
          where: { id: brandB.id },
          data: { name: `${prefix}-CROSS-HIJACK` },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const afterUpdate = await tenantBPrisma.brand.findFirstOrThrow({
        where: { id: brandB.id },
      });
      expect(afterUpdate.name).toBe(`${prefix}-CROSS-B`);

      await expect(
        tenantAPrisma.brand.delete({ where: { id: brandB.id } }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const stillExists = await tenantBPrisma.brand.findFirstOrThrow({
        where: { id: brandB.id },
      });
      expect(stillExists.id).toBe(brandB.id);
    });

    it('rejects an upsert whose selector is only an id', async () => {
      const brandB = await tenantBPrisma.brand.create({
        data: { tenant_id: tenantBId, ...brandData(`${prefix}-UPSERT-B`) },
      });

      await expect(
        tenantAPrisma.brand.upsert({
          where: { id: brandB.id },
          create: {
            tenant_id: tenantAId,
            ...brandData(`${prefix}-UPSERT-CREATED`),
          },
          update: { name: `${prefix}-UPSERT-HIJACK` },
        }),
      ).rejects.toThrow(
        /must use a tenant-scoped unique selector containing tenant_id/,
      );

      const unchanged = await tenantBPrisma.brand.findFirstOrThrow({
        where: { id: brandB.id },
      });
      expect(unchanged.name).toBe(`${prefix}-UPSERT-B`);
    });

    it('updates a row created earlier in the same interactive transaction', async () => {
      const brand = await runWithTenantContext(tenantAId, () =>
        prisma.$transaction(async (tx) => {
          const created = await tx.brand.create({
            data: { tenant_id: tenantAId, ...brandData(`${prefix}-TX-BRAND`) },
          });
          return tx.brand.update({
            where: { id: created.id },
            data: { name: `${prefix}-TX-BRAND-UPDATED` },
          });
        }),
      );

      expect(brand.name).toBe(`${prefix}-TX-BRAND-UPDATED`);

      const persisted = await tenantAPrisma.brand.findFirstOrThrow({
        where: { id: brand.id },
      });
      expect(persisted.name).toBe(`${prefix}-TX-BRAND-UPDATED`);
    });

    it('updates a row created earlier in the same dry-run transaction and rolls it back', async () => {
      const dryRunService = app.get(DryRunService);
      let createdId = '';

      const { result } = await runWithTenantContext(tenantAId, () =>
        dryRunService.executeInRollbackTransaction(async () => {
          const created = await prisma.customer.create({
            data: {
              tenant_id: tenantAId,
              first_name: 'Pilot',
              last_name: 'DryRun',
            },
          });
          createdId = created.id;
          return prisma.customer.update({
            where: { id: created.id },
            data: { last_name: 'DryRun Updated' },
          });
        }),
      );

      expect(result.last_name).toBe('DryRun Updated');

      const persisted = await tenantAPrisma.customer.findFirst({
        where: { id: createdId },
      });
      expect(persisted).toBeNull();
    });

    it('completes more parallel interactive transactions than the pool size', async () => {
      // ImportJob is not audited, so each in-transaction write uses only the
      // transaction connection and the test measures the tenant extension alone.
      const transactionCount = 12;
      const jobs = await Promise.all(
        Array.from({ length: transactionCount }, (_, index) =>
          tenantAPrisma.importJob.create({
            data: {
              tenant_id: tenantAId,
              entity_type: 'CUSTOMER',
              source_system: 'E2E',
              file_name: `${prefix}-CONCURRENT-${index}.csv`,
              file_sha256: `sha-${prefix}-${index}`,
              mapping_json: {},
              options_json: {},
              totals_json: {},
            },
          }),
        ),
      );

      const updated = await Promise.all(
        jobs.map((job) =>
          runWithTenantContext(tenantAId, () =>
            prisma.$transaction(
              (tx) =>
                tx.importJob.update({
                  where: { id: job.id },
                  data: { file_name: `${job.file_name}-updated` },
                }),
              { timeout: 15_000, maxWait: 15_000 },
            ),
          ),
        ),
      );

      expect(updated).toHaveLength(transactionCount);
      expect(new Set(updated.map((job) => job.id)).size).toBe(transactionCount);
    });
  });

  describe('HTTP role and tenant boundaries for id-scoped writes', () => {
    it('returns 404 when another tenant updates or deletes a brand by id', async () => {
      const brandB = await tenantBPrisma.brand.create({
        data: { tenant_id: tenantBId, ...brandData(`${prefix}-HTTP-B`) },
      });

      await request(app.getHttpServer())
        .patch(`/api/brands/${brandB.id}`)
        .set('Authorization', adminHeaderA)
        .send({ name: `${prefix}-HTTP-HIJACK` })
        .expect(404);

      const afterUpdate = await tenantBPrisma.brand.findFirstOrThrow({
        where: { id: brandB.id },
      });
      expect(afterUpdate.name).toBe(`${prefix}-HTTP-B`);

      await request(app.getHttpServer())
        .delete(`/api/brands/${brandB.id}`)
        .set('Authorization', adminHeaderA)
        .expect(404);

      const stillExists = await tenantBPrisma.brand.findFirstOrThrow({
        where: { id: brandB.id },
      });
      expect(stillExists.id).toBe(brandB.id);
    });

    it('returns 403 when a role without back-office permission updates or deletes by id', async () => {
      const brandA = await tenantAPrisma.brand.create({
        data: { tenant_id: tenantAId, ...brandData(`${prefix}-HTTP-A`) },
      });

      await request(app.getHttpServer())
        .patch(`/api/brands/${brandA.id}`)
        .set('Authorization', techHeaderA)
        .send({ name: `${prefix}-HTTP-A-TECH` })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/brands/${brandA.id}`)
        .set('Authorization', techHeaderA)
        .expect(403);

      const unchanged = await tenantAPrisma.brand.findFirstOrThrow({
        where: { id: brandA.id },
      });
      expect(unchanged.name).toBe(`${prefix}-HTTP-A`);
    });
  });
});
