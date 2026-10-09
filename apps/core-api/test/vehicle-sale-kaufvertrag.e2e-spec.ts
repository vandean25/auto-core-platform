import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  createTenantAwarePrisma,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';

describe('Vehicle sale Kaufvertrag PDF (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let token: string;
  let otherToken: string;
  let siteId: string;
  let unauthorizedSiteId: string;
  let buyerId: string;
  const archive = createInMemoryPdfArchive();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(archive)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);

    const tenant = await createTestTenant(prisma, 'aut-442-kaufvertrag');
    tenantId = tenant.tenantId;
    token = createTestAuthToken(app.get(AuthService), tenant);
    siteId = await resolveTestMainSiteId(prisma, tenantId);
    await prisma.user.update({
      where: { firebaseUid: tenant.firebaseUid },
      data: { active_site_id: siteId },
    });

    const scoped = createTenantAwarePrisma(prisma, tenantId);
    const legalEntity = await scoped.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { id: true },
    });
    const unauthorizedSite = await scoped.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntity.id,
        code: 'KVX',
        name: 'Second site without membership',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });
    unauthorizedSiteId = unauthorizedSite.id;

    const buyer = await scoped.customer.create({
      data: {
        tenant_id: tenantId,
        type: 'PRIVATE',
        first_name: 'Synthetic',
        last_name: 'Buyer',
        address_street: 'Beispielgasse 2',
        address_zip: '4020',
        address_city: 'Linz',
        address_country: 'AT',
      },
    });
    buyerId = buyer.id;

    const otherTenant = await createTestTenant(prisma, 'aut-442-kaufvertrag-other');
    otherTenantId = otherTenant.tenantId;
    otherToken = createTestAuthToken(app.get(AuthService), otherTenant);
  });

  afterAll(async () => {
    if (tenantId) await cleanupTestTenantGraph(prisma, tenantId);
    if (otherTenantId) await cleanupTestTenantGraph(prisma, otherTenantId);
    await teardownTestApp(app, prisma);
  });

  /** Consumer used car, first registered 2020, handed over 2026-10-08: 2-year base period. */
  async function seedSale(options: {
    saleNumber: string;
    site: string;
    firstRegistrationDate: Date;
    shortenedNegotiated?: boolean;
    endsOn: Date | null;
    presumptionEndsOn: Date | null;
    status?: 'DRAFT' | 'INVOICED';
  }): Promise<string> {
    const scoped = createTenantAwarePrisma(prisma, tenantId);
    const vehicle = await scoped.vehicle.create({
      data: {
        tenant_id: tenantId,
        site_id: options.site,
        make: 'Demo',
        model: 'Compact 1.0',
        year: 2020,
        vin: `DEMOVIN${options.saleNumber.replace(/\W/g, '').padEnd(11, '0')}`,
        hsn: '1234',
        tsn: 'ABC',
        color: 'Grau',
        mileage: 84500,
        first_registration_date: options.firstRegistrationDate,
      },
    });
    const sale = await scoped.vehicleSale.create({
      data: {
        tenant_id: tenantId,
        site_id: options.site,
        sale_number: options.saleNumber,
        status: options.status ?? 'DRAFT',
        vehicle_id: vehicle.id,
        customer_id: buyerId,
        sale_price: 18500,
        contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
        handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: options.shortenedNegotiated ?? false,
        gewaehrleistung_ends_on: options.endsOn,
        presumption_ends_on: options.presumptionEndsOn,
        gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
      },
    });
    return sale.id;
  }

  it('returns 404 until a Kaufvertrag PDF has been generated', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0001',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    const response = await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body.message).toBe('Kaufvertrag PDF is not generated yet');
  });

  it('generates the PDF inline, archives it, and serves the archived bytes', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0002',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    const generated = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(generated.body).toMatchObject({ mode: 'generated', saleId });
    expect(generated.body.key).toMatch(
      new RegExp(
        `^vehicle-sale-kaufvertrag-archives/${tenantId}/${saleId}/[a-f0-9]{64}/kaufvertrag-brand-v1\\.pdf$`,
      ),
    );

    const download = await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain(
      'kaufvertrag-VS_E2E_0002.pdf',
    );
    expect((download.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('reuses the cached archive when the facts have not changed', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0003',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });
    const first = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(second.body).toMatchObject({ mode: 'cached', key: first.body.key });
  });

  it('archives a new immutable object after a Garantie is added, and keeps the earlier object', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0004',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });
    const first = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        garantie_months: 12,
        garantie_terms: 'Motorschaden ausgenommen',
      })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(second.body.mode).toBe('generated');
    expect(second.body.key).not.toBe(first.body.key);
    expect(archive.objectsByKey.get(first.body.key)).toHaveLength(1);
  });

  it('does not serve the earlier archive after the facts change, until a new one is generated', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0009',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });
    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garantie_months: 12, garantie_terms: 'Motorschaden ausgenommen' })
      .expect(200);

    // The earlier archive is still referenced until the next generation, but it no longer matches the facts.
    const stale = await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(stale.body.message).toBe('Kaufvertrag PDF is not generated yet');

    const regenerated = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(regenerated.body.mode).toBe('generated');

    await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('refuses Garantie terms sent without a Garantie duration, and stores none', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0010',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    const refused = await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garantie_terms: 'Motorschaden ausgenommen' })
      .expect(422);
    expect(refused.body).toMatchObject({ code: 'GARANTIE_TERMS_REQUIRE_DURATION' });

    const sale = await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(sale.body.garantie_terms).toBeNull();
  });

  it('keeps the snapshot and the archive pointer out of the sale response', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0011',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });
    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const sale = await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(sale.body.kaufvertrag_generated_at).not.toBeNull();
    expect(sale.body.kaufvertrag_generation_error).toBeNull();
    for (const field of [
      'kaufvertrag_snapshot',
      'kaufvertrag_snapshot_sha256',
      'kaufvertrag_archive_bucket',
      'kaufvertrag_archive_key',
      'kaufvertrag_archive_generation',
      'kaufvertrag_archive_sha256',
    ]) {
      expect(sale.body).not.toHaveProperty(field);
    }
  });

  it('refuses a negotiated one-year period the vehicle cannot support when saving the sale', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0005',
      site: siteId,
      firstRegistrationDate: new Date('2026-03-01T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gewaehrleistung_shortened_negotiated: true })
      .expect(422);

    expect(response.body).toMatchObject({
      code: 'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
    });
  });

  it('refuses to generate a negotiated one-year period the vehicle cannot support, and writes no archive', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0006',
      site: siteId,
      firstRegistrationDate: new Date('2026-03-01T00:00:00.000Z'),
      shortenedNegotiated: true,
      endsOn: new Date('2027-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    const response = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(422);

    expect(response.body).toMatchObject({
      code: 'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
    });

    const scoped = createTenantAwarePrisma(prisma, tenantId);
    const stored = await scoped.vehicleSale.findFirstOrThrow({
      where: { id: saleId },
      select: {
        kaufvertrag_archive_key: true,
        kaufvertrag_generated_at: true,
      },
    });
    expect(stored).toEqual({
      kaufvertrag_archive_key: null,
      kaufvertrag_generated_at: null,
    });
    await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('keeps tenants apart: another tenant cannot generate or download the PDF', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0007',
      site: siteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('keeps sites apart: a sale on a site outside the active membership is not found', async () => {
    const saleId = await seedSale({
      saleNumber: 'VS-E2E-0008',
      site: unauthorizedSiteId,
      firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
      endsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
