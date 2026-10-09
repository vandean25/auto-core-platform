import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { signPdfTaskPayload } from '../src/common/pdf/pdf-task-payload.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';

const WORKER_SECRET = 'e2e-kaufvertrag-worker-secret';

describe('Vehicle sale Kaufvertrag Cloud Tasks worker (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let siteId: string;
  let buyerId: string;
  const archive = createInMemoryPdfArchive('e2e-worker-archive');
  const originalSecret = process.env.CLOUD_TASKS_WORKER_SECRET;

  beforeAll(async () => {
    process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(archive)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);

    const tenant = await createTestTenant(prisma, 'aut-442-kaufvertrag-worker');
    tenantId = tenant.tenantId;
    siteId = await resolveTestMainSiteId(prisma, tenantId);
    const scoped = createTenantAwarePrisma(prisma, tenantId);
    const buyer = await scoped.customer.create({
      data: {
        tenant_id: tenantId,
        type: 'PRIVATE',
        first_name: 'Synthetic',
        last_name: 'Buyer',
      },
    });
    buyerId = buyer.id;

    const other = await createTestTenant(prisma, 'aut-442-kaufvertrag-worker-other');
    otherTenantId = other.tenantId;
  });

  afterAll(async () => {
    if (originalSecret === undefined) {
      delete process.env.CLOUD_TASKS_WORKER_SECRET;
    } else {
      process.env.CLOUD_TASKS_WORKER_SECRET = originalSecret;
    }
    if (tenantId) await cleanupTestTenantGraph(prisma, tenantId);
    if (otherTenantId) await cleanupTestTenantGraph(prisma, otherTenantId);
    await teardownTestApp(app, prisma);
  });

  /** Consumer used car with a 2-year base period; `firstRegistrationDate` drives the negotiated 1-year guard. */
  async function seedSale(options: {
    saleNumber: string;
    firstRegistrationDate: Date;
    shortenedNegotiated?: boolean;
    endsOn: Date;
  }): Promise<string> {
    const scoped = createTenantAwarePrisma(prisma, tenantId);
    const vehicle = await scoped.vehicle.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        make: 'Demo',
        model: 'Compact 1.0',
        year: 2020,
        vin: `DEMOVINWRK${options.saleNumber.replace(/\W/g, '').padEnd(8, '0')}`,
        first_registration_date: options.firstRegistrationDate,
      },
    });
    const sale = await scoped.vehicleSale.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        sale_number: options.saleNumber,
        status: 'DRAFT',
        vehicle_id: vehicle.id,
        customer_id: buyerId,
        sale_price: 18500,
        contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
        handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: options.shortenedNegotiated ?? false,
        gewaehrleistung_ends_on: options.endsOn,
        presumption_ends_on: new Date('2027-10-08T00:00:00.000Z'),
        gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
      },
    });
    return sale.id;
  }

  function signedTask(overrides: Partial<{ kind: string; resourceId: string; tenantId: string }>) {
    return signPdfTaskPayload(
      {
        kind: 'vehicle-sale-kaufvertrag',
        resourceId: overrides.resourceId ?? '',
        tenantId: overrides.tenantId ?? tenantId,
        ...(overrides.kind ? { kind: overrides.kind as 'vehicle-sale-kaufvertrag' } : {}),
      },
      WORKER_SECRET,
    );
  }

  it('archives the PDF when a signed Cloud Tasks payload reaches the worker route', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-WRK-0001',
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .send(signedTask({ resourceId: saleId }))
      .expect(204);

    const stored = await createTenantAwarePrisma(prisma, tenantId).vehicleSale.findFirstOrThrow({
      where: { id: saleId },
      select: { kaufvertrag_archive_key: true },
    });
    expect(stored.kaufvertrag_archive_key).toMatch(
      new RegExp(`^vehicle-sale-kaufvertrag-archives/${tenantId}/${saleId}/`),
    );
  });

  it('refuses a worker call without the shared worker secret', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-WRK-0002',
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf/worker`)
      .send(signedTask({ resourceId: saleId }))
      .expect(401);
  });

  it('refuses a signed payload that names a different document kind', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-WRK-0003',
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .send(signedTask({ resourceId: saleId, kind: 'invoice' }))
      .expect(403);
  });

  it('refuses a signed payload that names a different sale than the route', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-WRK-0004',
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .send(signedTask({ resourceId: '00000000-0000-4000-8000-00000000ffff' }))
      .expect(403);
  });

  it('drops a non-retryable blocked one-year generation and records the reason for the poll', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-WRK-0005',
      firstRegistrationDate: new Date('2026-03-01T00:00:00.000Z'),
      shortenedNegotiated: true,
      endsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .send(signedTask({ resourceId: saleId }))
      .expect(204);

    const stored = await createTenantAwarePrisma(prisma, tenantId).vehicleSale.findFirstOrThrow({
      where: { id: saleId },
      select: {
        kaufvertrag_archive_key: true,
        kaufvertrag_generation_error: true,
      },
    });
    expect(stored.kaufvertrag_archive_key).toBeNull();
    expect(stored.kaufvertrag_generation_error).toBe(
      'Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.',
    );
  });

  it('keeps the worker tenant apart: a payload signed for another tenant cannot archive this sale', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-WRK-0006',
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
    });

    // The sale is not visible to the other tenant, so the worker drops the
    // task as non-retryable (204) and writes nothing to this tenant's sale.
    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .send(signedTask({ resourceId: saleId, tenantId: otherTenantId }))
      .expect(204);

    const stored = await createTenantAwarePrisma(prisma, tenantId).vehicleSale.findFirstOrThrow({
      where: { id: saleId },
      select: { kaufvertrag_archive_key: true },
    });
    expect(stored.kaufvertrag_archive_key).toBeNull();
  });
});
