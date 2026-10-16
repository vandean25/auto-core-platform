import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { parseApiKeyToken } from '../src/public-api/api-keys/api-key-token.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  STATUTORY_MANIFEST_REFERENCE,
  STATUTORY_MANIFEST_REFERENCE_ALT,
} from '../src/inspection-catalog/inspection-catalog-synthetic-fixtures.js';

describe('Inspection catalogue (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  let siteId: string;
  let orderId: string;
  let taskId: string;
  let inspectionId: string;
  let catalogueVersionId: string;
  let actorUserId: string;

  function previewCatalogue(manifestRef = STATUTORY_MANIFEST_REFERENCE) {
    return request(app.getHttpServer())
      .post('/api/inspection-catalogues/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ manifest_reference: manifestRef });
  }

  function activateCatalogue(previewBody: {
    id: string;
    fingerprint: string;
    version: number;
  }) {
    return request(app.getHttpServer())
      .post(`/api/inspection-catalogues/${previewBody.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: previewBody.fingerprint,
        version: previewBody.version,
      });
  }

  async function ensureActivatedCatalogue() {
    const preview = await previewCatalogue().expect(201);
    const activate = await activateCatalogue(preview.body).expect(200);
    catalogueVersionId = activate.body.catalogue_version_id;
    return activate.body;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'inspection-catalog');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    token = createTestAuthToken(app.get(AuthService), testTenant);

    await runWithTenantContext(tenantId, async () => {
      const site = await prisma.site.findFirst({ where: { tenant_id: tenantId } });
      if (!site) {
        throw new Error('missing site');
      }
      siteId = site.id;

      const adminUser = await basePrisma.user.findFirst({
        where: { firebaseUid: testTenant.firebaseUid },
        select: { id: true },
      });
      if (!adminUser) {
        throw new Error('missing admin user');
      }
      actorUserId = adminUser.id;

      const customer = await prisma.customer.create({
        data: {
          tenant_id: tenantId,
          type: 'PRIVATE',
          first_name: 'SYNTH',
          last_name: 'KUNDE',
          email: `synth-catalog-${Date.now()}@example.com`,
        },
      });

      const vehicle = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: `WVWZZZ1JZXW${String(Date.now()).slice(-6)}`,
          customer_id: customer.id,
          first_registration_date: new Date('2020-10-01T00:00:00.000Z'),
        },
      });

      const order = await prisma.workshopOrder.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          status: 'IN_PROGRESS',
          order_number: `WO-SYNTH-CAT-${Date.now()}`,
          odometer: 42_000,
          fuel_level: 50,
        },
      });
      orderId = order.id;

      const task = await prisma.workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          title: '§57a Vorbereitung',
          status: 'IN_PROGRESS',
          sequence: 1,
        },
      });
      taskId = task.id;

      const inspection = await prisma.workshopInspection.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          workshop_task_id: taskId,
          title: 'PICKERL_57A_PREP',
        },
      });
      inspectionId = inspection.id;
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app);
  });

  it('previews and activates statutory subset manifest', async () => {
    const preview = await previewCatalogue().expect(201);
    expect(preview.body.state).toBe('READY_FOR_ACTIVATION');
    expect(preview.body.coverage).toBe('SUBSET');

    const activate = await activateCatalogue(preview.body).expect(200);
    expect(activate.body.replay).toBe(false);
    expect(activate.body.catalogue_version_id).toBeTruthy();
    catalogueVersionId = activate.body.catalogue_version_id;
  });

  it('resolves position-only reference for statutory 0.1', async () => {
    await ensureActivatedCatalogue();

    const resolve = await request(app.getHttpServer())
      .get('/api/inspection-catalogues/references')
      .query({ position_id: '0.1', vehicle_class: 'M1' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resolve.body.data[0].status).toBe('RESOLVED');
    expect(resolve.body.data[0].coverage).toBe('SUBSET');
  });

  it('attaches position-only statutory reference without vehicle scope proof', async () => {
    await ensureActivatedCatalogue();

    await request(app.getHttpServer())
      .post('/api/inspection-catalogues/finding-references')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        position_id: '0.1',
      })
      .expect(201);
  });

  it('rejects unknown catalogue codes', async () => {
    const resolve = await request(app.getHttpServer())
      .get('/api/inspection-catalogues/references')
      .query({ position_id: 'SYNTH-NOT-A-CODE' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resolve.body.data[0].status).toBe('UNKNOWN_CODE');
  });

  it('returns NOT_CONFIGURED for approved catalogue manifest', async () => {
    await previewCatalogue('APPROVED_CATALOGUE').expect(422);
  });

  it('flags STALE_CATALOG at recheck_after inclusive boundary', async () => {
    await ensureActivatedCatalogue();

    const resolve = await request(app.getHttpServer())
      .get('/api/inspection-catalogues/references')
      .query({
        position_id: '0.1',
        inspection_time: '2026-11-15T10:00:00.000Z',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resolve.body.data[0].status).toBe('STALE_CATALOG');
  });

  it('returns CONFLICT preview when overlapping statutory version exists', async () => {
    await ensureActivatedCatalogue();

    const overlapPreview = await previewCatalogue(
      STATUTORY_MANIFEST_REFERENCE_ALT,
    ).expect(201);
    expect(overlapPreview.body.state).toBe('CONFLICT');
    expect(overlapPreview.body.error_code).toBe('SOURCE_CONFLICT');
  });

  it('creates a separate activation row for a second site', async () => {
    await ensureActivatedCatalogue();

    let secondSiteId = '';
    await runWithTenantContext(tenantId, async () => {
      const legalEntity = await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantId },
      });
      const secondSite = await prisma.site.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntity.id,
          code: `CAT-B-${Date.now()}`,
          name: 'Catalogue site B',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
          is_active: true,
        },
      });
      secondSiteId = secondSite.id;
      await prisma.siteMembership.create({
        data: {
          tenant_id: tenantId,
          user_id: actorUserId,
          site_id: secondSiteId,
          is_active: true,
        },
      });
      await basePrisma.user.update({
        where: { id: actorUserId },
        data: { active_site_id: secondSiteId },
      });
    });

    const preview = await previewCatalogue().expect(201);
    const activate = await activateCatalogue(preview.body).expect(200);
    expect(activate.body.replay).toBe(false);

    const activations = await prisma.tenantInspectionCatalogueActivation.findMany(
      {
        where: {
          tenant_id: tenantId,
          catalogue_version_id: catalogueVersionId,
          deactivated_at: null,
        },
      },
    );
    expect(activations.map((row) => row.site_id).sort()).toEqual(
      [siteId, secondSiteId].sort(),
    );

    await basePrisma.user.update({
      where: { id: actorUserId },
      data: { active_site_id: siteId },
    });
  });

  it('preserves finding snapshots when checklist rows are deleted', async () => {
    await ensureActivatedCatalogue();

    await request(app.getHttpServer())
      .post('/api/inspection-catalogues/finding-references')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        position_id: '0.1',
      })
      .expect(201);

    await runWithTenantContext(tenantId, async () => {
      await prisma.workshopInspectionItem.create({
        data: {
          tenant_id: tenantId,
          workshop_inspection_id: inspectionId,
          label_snapshot: 'Checklist row',
        },
      });
      await prisma.workshopInspectionItem.deleteMany({
        where: { workshop_inspection_id: inspectionId },
      });
    });

    const references = await request(app.getHttpServer())
      .get(`/api/workshop-inspections/${inspectionId}/catalogue-references`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(references.body.data.length).toBeGreaterThan(0);
    expect(references.body.meta.total).toBeGreaterThan(0);
  });

  it('returns 404 for foreign tenant inspection list', async () => {
    const otherTenant = await createTestTenant(
      basePrisma,
      'inspection-catalog-other',
    );
    const otherToken = createTestAuthToken(app.get(AuthService), otherTenant);

    await request(app.getHttpServer())
      .get(`/api/workshop-inspections/${inspectionId}/catalogue-references`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    await cleanupTestTenantGraph(basePrisma, otherTenant.tenantId);
  });

  it('returns 404 when inspection belongs to another site', async () => {
    let otherSiteInspectionId = '';
    await runWithTenantContext(tenantId, async () => {
      const legalEntity = await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantId },
      });
      const otherSite = await prisma.site.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntity.id,
          code: `CAT-ISO-${Date.now()}`,
          name: 'Isolated site',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
          is_active: true,
        },
      });
      const otherInspection = await prisma.workshopInspection.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          workshop_task_id: taskId,
          title: 'OTHER_SITE_PREP',
        },
      });
      otherSiteInspectionId = otherInspection.id;
      await prisma.workshopOrder.update({
        where: { id: orderId },
        data: { site_id: otherSite.id },
      });
    });

    await request(app.getHttpServer())
      .get(
        `/api/workshop-inspections/${otherSiteInspectionId}/catalogue-references`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    await runWithTenantContext(tenantId, async () => {
      await prisma.workshopOrder.update({
        where: { id: orderId },
        data: { site_id: siteId },
      });
    });
  });

  it('returns 400 for malformed codes JSON', async () => {
    await request(app.getHttpServer())
      .get('/api/inspection-catalogues/references')
      .query({ codes: '{not-json' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('paginates catalogue references beyond fifty rows', async () => {
    await ensureActivatedCatalogue();

    await runWithTenantContext(tenantId, async () => {
      await prisma.inspectionFindingReference.createMany({
        data: Array.from({ length: 55 }, (_, index) => ({
          tenant_id: tenantId,
          site_id: siteId,
          workshop_inspection_id: inspectionId,
          catalogue_version_id: catalogueVersionId,
          position_id: `0.${index + 1}`,
          entry_id: null,
          label_snapshot: `Synthetic ${index}`,
          allowed_groups_snapshot: [],
          provenance_snapshot: { source_version: STATUTORY_MANIFEST_REFERENCE },
          created_by_user_id: actorUserId,
        })),
      });
    });

    const pageOne = await request(app.getHttpServer())
      .get(`/api/workshop-inspections/${inspectionId}/catalogue-references`)
      .query({ page: 1, limit: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(pageOne.body.data).toHaveLength(50);
    expect(pageOne.body.meta.total).toBeGreaterThanOrEqual(55);

    const pageTwo = await request(app.getHttpServer())
      .get(`/api/workshop-inspections/${inspectionId}/catalogue-references`)
      .query({ page: 2, limit: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(pageTwo.body.data.length).toBeGreaterThan(0);
  });

  it('returns 403 for API key on session-only catalogue routes', async () => {
    const keyResponse = await request(app.getHttpServer())
      .post('/api/tenant-api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Catalogue e2e',
        scopes: ['workshop-orders:read', 'customers:read'],
      })
      .expect(201);

    const parsed = parseApiKeyToken(keyResponse.body.token);
    if (!parsed) {
      throw new Error('expected acp_live token');
    }

    await request(app.getHttpServer())
      .get('/api/inspection-catalogues/references')
      .query({ position_id: '0.1' })
      .set('Authorization', `Bearer ${keyResponse.body.token}`)
      .expect(403);
  });

  it('preserves historical finding snapshots after new activation', async () => {
    const firstPreview = await previewCatalogue().expect(201);
    const firstActivate = await activateCatalogue(firstPreview.body).expect(200);

    await request(app.getHttpServer())
      .post('/api/inspection-catalogues/finding-references')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        position_id: '0.1',
      })
      .expect(201);

    const references = await request(app.getHttpServer())
      .get(`/api/workshop-inspections/${inspectionId}/catalogue-references`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(references.body.data.length).toBeGreaterThan(0);
    expect(references.body.data[0].source_version).toBeTruthy();
    expect(firstActivate.body.catalogue_version_id).toBeTruthy();

    const checklistBefore = await prisma.workshopInspectionItem.findMany({
      where: { workshop_inspection_id: inspectionId },
    });
    expect(checklistBefore).toHaveLength(0);
  });

  it('returns 403 for tech on catalogue activation', async () => {
    const techFirebaseUid = `tech-catalog-${Date.now()}`;
    const techEmail = `${techFirebaseUid}@example.com`;
    let techUserId = '';
    await runWithTenantContext(tenantId, async () => {
      const techUser = await prisma.user.create({
        data: {
          firebaseUid: techFirebaseUid,
          email: techEmail,
        },
      });
      techUserId = techUser.id;
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUserId,
        role: 'TECH',
      });
      await prisma.siteMembership.create({
        data: {
          tenant_id: tenantId,
          user_id: techUserId,
          site_id: siteId,
          is_active: true,
        },
      });
      await prisma.user.update({
        where: { id: techUserId },
        data: { active_tenant_id: tenantId, active_site_id: siteId },
      });
    });
    const techToken = createTestAuthToken(app.get(AuthService), {
      tenantId,
      firebaseUid: techFirebaseUid,
      email: techEmail,
      role: 'TECH',
    });

    await request(app.getHttpServer())
      .post('/api/inspection-catalogues/preview')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ manifest_reference: STATUTORY_MANIFEST_REFERENCE })
      .expect(403);
  });
});
