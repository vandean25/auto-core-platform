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

    await tenantAPrisma.customer.deleteMany({
      where: { last_name: { startsWith: prefix } },
    });
    await tenantBPrisma.customer.deleteMany({
      where: { last_name: { startsWith: prefix } },
    });

    await tenantAPrisma.salesOrder.deleteMany({
      where: { order_number: { startsWith: prefix } },
    });
    await tenantBPrisma.salesOrder.deleteMany({
      where: { order_number: { startsWith: prefix } },
    });

    await tenantAPrisma.vendor.deleteMany({
      where: { account_number: { startsWith: prefix } },
    });
    await tenantBPrisma.vendor.deleteMany({
      where: { account_number: { startsWith: prefix } },
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

      await tenantAPrisma.customer.deleteMany({
        where: { last_name: { startsWith: prefix } },
      });
      await tenantBPrisma.customer.deleteMany({
        where: { last_name: { startsWith: prefix } },
      });

      await tenantAPrisma.salesOrder.deleteMany({
        where: { order_number: { startsWith: prefix } },
      });
      await tenantBPrisma.salesOrder.deleteMany({
        where: { order_number: { startsWith: prefix } },
      });

      await tenantAPrisma.vendor.deleteMany({
        where: { account_number: { startsWith: prefix } },
      });
      await tenantBPrisma.vendor.deleteMany({
        where: { account_number: { startsWith: prefix } },
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

    it('completes more parallel interactive transactions than the pool size on an audited model', async () => {
      // Brand is audited, so each transaction also writes its audit row. The
      // audit insert must reuse the transaction connection; otherwise every
      // parallel write needs a second pooled connection and exhausts the pool.
      const transactionCount = 12;
      const brands = await Promise.all(
        Array.from({ length: transactionCount }, (_, index) =>
          tenantAPrisma.brand.create({
            data: {
              tenant_id: tenantAId,
              ...brandData(`${prefix}-CONCURRENT-${index}-${Date.now()}`),
            },
          }),
        ),
      );

      const updated = await Promise.all(
        brands.map((brand) =>
          runWithTenantContext(tenantAId, () =>
            prisma.$transaction(
              (tx) =>
                tx.brand.update({
                  where: { id: brand.id },
                  data: { logoUrl: `${prefix}-logo-${brand.id}.png` },
                }),
              { timeout: 15_000, maxWait: 15_000 },
            ),
          ),
        ),
      );

      expect(updated).toHaveLength(transactionCount);
      expect(new Set(updated.map((brand) => brand.id)).size).toBe(
        transactionCount,
      );

      const auditRows = await tenantAPrisma.auditLog.findMany({
        where: {
          entity_type: 'Brand',
          entity_id: { in: updated.map((brand) => String(brand.id)) },
        },
      });
      expect(auditRows).toHaveLength(transactionCount);
    });

    it('does not persist an audit row when the transaction rolls back', async () => {
      const brand = await tenantAPrisma.brand.create({
        data: { tenant_id: tenantAId, ...brandData(`${prefix}-ROLLBACK`) },
      });

      await expect(
        runWithTenantContext(tenantAId, () =>
          prisma.$transaction(async (tx) => {
            await tx.brand.update({
              where: { id: brand.id },
              data: { name: `${prefix}-ROLLBACK-UPDATED` },
            });
            throw new Error('force rollback');
          }),
        ),
      ).rejects.toThrow('force rollback');

      const auditRows = await tenantAPrisma.auditLog.findMany({
        where: {
          entity_type: 'Brand',
          entity_id: String(brand.id),
        },
      });
      expect(auditRows).toEqual([]);

      const unchanged = await tenantAPrisma.brand.findFirstOrThrow({
        where: { id: brand.id },
      });
      expect(unchanged.name).toBe(`${prefix}-ROLLBACK`);
    });

    it('does not persist an audit row during a dry-run transaction', async () => {
      const customer = await tenantAPrisma.customer.create({
        data: {
          tenant_id: tenantAId,
          first_name: 'Pilot',
          last_name: `${prefix}-DRYRUN`,
        },
      });
      const dryRunService = app.get(DryRunService);

      await runWithTenantContext(tenantAId, () =>
        dryRunService.executeInRollbackTransaction(() =>
          prisma.customer.update({
            where: { id: customer.id },
            data: { last_name: `${prefix}-DRYRUN-UPDATED` },
          }),
        ),
      );

      const auditRows = await tenantAPrisma.auditLog.findMany({
        where: {
          entity_type: 'Customer',
          entity_id: String(customer.id),
        },
      });
      expect(auditRows).toEqual([]);

      const unchanged = await tenantAPrisma.customer.findFirstOrThrow({
        where: { id: customer.id },
      });
      expect(unchanged.last_name).toBe(`${prefix}-DRYRUN`);
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

  describe('AUT-818 deny-by-default and *AndReturn regression tests', () => {
    it('stamps tenant_id per row on createManyAndReturn', async () => {
      const results = await tenantAPrisma.brand.createManyAndReturn({
        data: [
          brandData(`${prefix}-AND-RETURN-1`) as any,
          brandData(`${prefix}-AND-RETURN-2`) as any,
        ],
      });

      expect(results).toHaveLength(2);
      expect(results[0].tenant_id).toBe(tenantAId);
      expect(results[1].tenant_id).toBe(tenantAId);

      const inDbA = await tenantAPrisma.brand.findMany({
        where: {
          name: {
            in: [`${prefix}-AND-RETURN-1`, `${prefix}-AND-RETURN-2`],
          },
        },
      });
      expect(inDbA).toHaveLength(2);

      const inDbB = await tenantBPrisma.brand.findMany({
        where: {
          name: {
            in: [`${prefix}-AND-RETURN-1`, `${prefix}-AND-RETURN-2`],
          },
        },
      });
      expect(inDbB).toHaveLength(0);
    });

    it("updateManyAndReturn does not touch or return another tenant's rows", async () => {
      const brandA = await tenantAPrisma.brand.create({
        data: { tenant_id: tenantAId, ...brandData(`${prefix}-UP-RET-A`) },
      });
      const brandB = await tenantBPrisma.brand.create({
        data: { tenant_id: tenantBId, ...brandData(`${prefix}-UP-RET-B`) },
      });

      const updated = await tenantAPrisma.brand.updateManyAndReturn({
        where: { name: { startsWith: `${prefix}-UP-RET` } },
        data: { logoUrl: `${prefix}-updated-logo.png` },
      });

      expect(updated).toHaveLength(1);
      expect(updated[0].id).toBe(brandA.id);
      expect(updated[0].tenant_id).toBe(tenantAId);

      const checkB = await tenantBPrisma.brand.findFirstOrThrow({
        where: { id: brandB.id },
      });
      expect(checkB.logoUrl).toBeNull();
    });

    it("rejects a nested connect to another tenant's row", async () => {
      const customerB = await tenantBPrisma.customer.create({
        data: {
          tenant_id: tenantBId,
          first_name: 'Adversarial',
          last_name: 'Target',
        },
      });

      await expect(
        tenantAPrisma.workshopOrder.create({
          data: {
            tenant_id: tenantAId,
            order_number: `${prefix}-WO-ADV`,
            customer: {
              connect: { id: customerB.id },
            },
          } as any,
        }),
      ).rejects.toThrow(/\[TenantIsolation\] Nested relation write/);
    });

    it('rejects nested connect on single-FK child relations like PurchaseOrder.items', async () => {
      await expect(
        tenantAPrisma.purchaseOrder.create({
          data: {
            tenant_id: tenantAId,
            site_id: 'nonexistent-site',
            order_number: `${prefix}-PO-ADV-CONN`,
            status: 'DRAFT',
            items: {
              connect: [{ id: 'nonexistent-item' }],
            },
          } as any,
        }),
      ).rejects.toThrow(
        /\[TenantIsolation\] Nested relation write on 'PurchaseOrder\.items' targeting tenant-scoped model 'PurchaseOrderItem' is not permitted\./,
      );
    });

    it('rejects nested create with mismatching tenant_id on single-FK child relation', async () => {
      await expect(
        tenantAPrisma.salesOrder.create({
          data: {
            tenant_id: tenantAId,
            site_id: 'nonexistent-site',
            order_number: `${prefix}-SO-MISMATCH`,
            status: 'DRAFT',
            total_amount: 10,
            items: {
              create: [
                {
                  description: 'Adversarial child item',
                  quantity: 1,
                  unit_price: 10,
                  total: 10,
                  tenant_id: tenantBId,
                },
              ],
            },
          } as any,
        }),
      ).rejects.toThrow(
        /\[TenantIsolation\] Mismatching tenant_id in create on model 'SalesOrderItem'\./,
      );
    });

    it('stamps own-tenant tenant_id on nested create for single-FK child relations', async () => {
      const siteA = await tenantAPrisma.site.findFirstOrThrow({
        where: { tenant_id: tenantAId },
      });
      const customerA = await tenantAPrisma.customer.create({
        data: {
          tenant_id: tenantAId,
          first_name: 'Own',
          last_name: 'Customer',
        },
      });

      const so = await tenantAPrisma.salesOrder.create({
        data: {
          tenant_id: tenantAId,
          site_id: siteA.id,
          customer_id: customerA.id,
          order_number: `${prefix}-SO-STAMP`,
          status: 'DRAFT',
          total_amount: 50,
          items: {
            create: [
              {
                description: 'Auto-stamped child item',
                quantity: 1,
                unit_price: 50,
                total: 50,
              },
            ],
          },
        },
        include: { items: true },
      });

      expect(so.items).toHaveLength(1);
      expect(so.items[0].tenant_id).toBe(tenantAId);
      expect(so.items[0].description).toBe('Auto-stamped child item');
    });

    it("rejects Vendor.supportedBrands connect targeting another tenant's brand", async () => {
      const brandB = await tenantBPrisma.brand.create({
        data: {
          tenant_id: tenantBId,
          ...brandData(`${prefix}-BRAND-B-VEND`),
        },
      });

      await expect(
        tenantAPrisma.vendor.create({
          data: {
            tenant_id: tenantAId,
            name: `${prefix}-Vendor-Adv`,
            email: 'adv-vendor@example.com',
            account_number: `${prefix}-V-ADV`,
            supportedBrands: {
              connect: [{ id: brandB.id }],
            },
          },
        }),
      ).rejects.toThrow(
        /\[TenantIsolation\] Nested relation write on 'Vendor\.supportedBrands' references brands not belonging to current tenant\./,
      );
    });

    it("permits Vendor.supportedBrands connect targeting own tenant's brand", async () => {
      const brandA = await tenantAPrisma.brand.create({
        data: {
          tenant_id: tenantAId,
          ...brandData(`${prefix}-BRAND-A-VEND`),
        },
      });

      const vendor = await tenantAPrisma.vendor.create({
        data: {
          tenant_id: tenantAId,
          name: `${prefix}-Vendor-Own`,
          email: 'own-vendor@example.com',
          account_number: `${prefix}-V-OWN`,
          supportedBrands: {
            connect: [{ id: brandA.id }],
          },
        },
        include: { supportedBrands: true },
      });

      expect(vendor.supportedBrands).toHaveLength(1);
      expect(vendor.supportedBrands[0].id).toBe(brandA.id);
      expect(vendor.supportedBrands[0].tenant_id).toBe(tenantAId);
    });

    it('count, aggregate, and groupBy with overlapping data return only own-tenant results', async () => {
      await tenantAPrisma.brand.create({
        data: {
          tenant_id: tenantAId,
          ...brandData(`${prefix}-AGG-1`),
          isPartManufacturer: true,
        },
      });
      await tenantAPrisma.brand.create({
        data: {
          tenant_id: tenantAId,
          ...brandData(`${prefix}-AGG-2`),
          isPartManufacturer: true,
        },
      });
      await tenantBPrisma.brand.create({
        data: {
          tenant_id: tenantBId,
          ...brandData(`${prefix}-AGG-3`),
          isPartManufacturer: true,
        },
      });

      // count
      const countA = await tenantAPrisma.brand.count({
        where: { name: { startsWith: prefix } },
      });
      expect(countA).toBe(2);

      const countB = await tenantBPrisma.brand.count({
        where: { name: { startsWith: prefix } },
      });
      expect(countB).toBe(1);

      // aggregate with _count
      const aggregateA = await tenantAPrisma.brand.aggregate({
        where: { name: { startsWith: prefix } },
        _count: { id: true },
      });
      expect(aggregateA._count.id).toBe(2);

      const aggregateB = await tenantBPrisma.brand.aggregate({
        where: { name: { startsWith: prefix } },
        _count: { id: true },
      });
      expect(aggregateB._count.id).toBe(1);

      // groupBy with having
      const groupByA = await tenantAPrisma.brand.groupBy({
        by: ['isPartManufacturer'],
        where: { name: { startsWith: prefix } },
        having: { isPartManufacturer: { _count: { gte: 2 } } },
        _count: { id: true },
      });
      expect(groupByA).toHaveLength(1);
      const countObjA = groupByA[0]._count;
      expect(typeof countObjA === 'object' && countObjA ? countObjA.id : countObjA).toBe(2);

      const groupByB = await tenantBPrisma.brand.groupBy({
        by: ['isPartManufacturer'],
        where: { name: { startsWith: prefix } },
        having: { isPartManufacturer: { _count: { gte: 2 } } },
        _count: { id: true },
      });
      expect(groupByB).toHaveLength(0);
    });
  });
});
