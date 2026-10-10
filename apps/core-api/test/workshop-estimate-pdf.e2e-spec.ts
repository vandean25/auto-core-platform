import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  CloudTasksService,
  createGlobalValidationPipe,
  signPdfTaskPayload,
} from '../src/common/index.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { DocumentBrandingAssetStorage } from '../src/document-branding/document-branding-asset-storage.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from '../src/document-branding/theme-v1.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkshopEstimatePdfRenderer } from '../src/workshop/workshop-estimate-pdf.renderer.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  cleanupTestUsers,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  seedTestTenantMember,
} from './tenant-test-utils.js';

const WORKER_SECRET = 'workshop-estimate-pdf-e2e-worker-secret';
const SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';
const WRITER_FLAG = 'INVOICE_BRANDING_WRITER_ENABLED';
const PDF_BYTES = Buffer.from('%PDF-1.4 workshop estimate e2e archive');
const LOGO_BYTES = Buffer.from('AUT-354 frozen estimate logo fixture');
const SAFE_ERROR = 'PDF generation failed. Please try again or contact support.';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Workshop estimate PDF (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let customerId: string;
  let legalEntityId: string;
  let renderSpy: jest.SpyInstance;
  let logoReadSpy: jest.SpyInstance;
  let previousSendFlag: string | undefined;
  let previousWriterFlag: string | undefined;
  let previousWorkerSecret: string | undefined;
  // Users created by this suite are cleaned up. Tenants stay isolated by their own ids.
  const createdUserIds: string[] = [];
  const archive = createInMemoryPdfArchive('e2e-estimate-archive');

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  function getPdf(versionId: string, token = adminToken) {
    return api()
      .get(`/api/workshop/estimates/${versionId}/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  function signedTask(
    kind: 'workshop-estimate' | 'workshop-order',
    resourceId: string,
    taskTenantId = tenantId,
  ) {
    return signPdfTaskPayload(
      { kind, resourceId, tenantId: taskTenantId },
      WORKER_SECRET,
    );
  }

  function postWorker(versionId: string, payload: unknown) {
    return api()
      .post(`/api/workshop/estimates/${versionId}/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .send(payload);
  }

  function latestRender(): { snapshot: unknown; logoPng?: Buffer } {
    const calls = renderSpy.mock.calls;
    if (calls.length === 0) {
      throw new Error('The estimate renderer was not called');
    }
    return calls[calls.length - 1][0] as { snapshot: unknown; logoPng?: Buffer };
  }

  async function createTechToken(): Promise<string> {
    const firebaseUid = `estimate-pdf-tech-${randomUUID()}`;
    const email = `${firebaseUid}@example.com`;
    const user = await basePrisma.user.create({
      data: { firebaseUid, email },
    });
    createdUserIds.push(user.id);
    await seedTestTenantMember(basePrisma, {
      tenantId,
      userId: user.id,
      role: 'TECH',
    });
    return app.get(AuthService).createTestToken({
      sub: firebaseUid,
      email,
      tenantId,
      role: 'TECH',
    });
  }

  async function createOrderWithLabor(qty = 2, unitPrice = 80) {
    // One open order per vehicle: every order gets its own vehicle.
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        vin: `VIN-PDF-${randomUUID()}`,
        customer_id: customerId,
      },
    });
    const order = await api()
      .post('/api/workshop/orders')
      .set(adminAuth())
      .send({
        customerId,
        vehicleId: vehicle.id,
        odometer: 98450,
        fuelLevel: 40,
        notes: 'Ölwechsel',
      })
      .expect(201);
    const orderId = order.body.id as string;
    const task = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Ölwechsel' })
      .expect(201);
    await api()
      .patch(
        `/api/workshop/orders/${orderId}/tasks/${task.body.id as string}/line-items`,
      )
      .set(adminAuth())
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-OIL',
            description: 'Ölwechsel',
            qty,
            unitPrice,
          },
        ],
      })
      .expect(200);
    return orderId;
  }

  async function createDraftEstimate(): Promise<string> {
    const orderId = await createOrderWithLabor();
    const created = await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(201);
    return created.body.versions[0].id as string;
  }

  function sendVersion(versionId: string) {
    return api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(adminAuth())
      .expect(200);
  }

  beforeAll(async () => {
    previousSendFlag = process.env[SEND_FLAG];
    previousWriterFlag = process.env[WRITER_FLAG];
    previousWorkerSecret = process.env.CLOUD_TASKS_WORKER_SECRET;
    process.env[SEND_FLAG] = 'true';
    // Estimates must not depend on the invoice branding writer flag (ADR-0025 §3).
    delete process.env[WRITER_FLAG];
    process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(archive)
      // Inline rendering outside production keeps the e2e run deterministic.
      .overrideProvider(CloudTasksService)
      .useValue({ isEnabled: () => false, enqueuePdfGeneration: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'workshop-estimate-pdf');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);
    await seedReadySellerAndAccountingProfile(basePrisma, tenantId);
    // workshop_orders.order_number is globally unique in the shared e2e database, so every
    // tenant counting from WO-…-0001 collides with the other suites. Start this tenant's
    // counter at a per-run value, the same isolation finance.e2e-spec.ts uses for sales orders.
    const workshopOrderStart = 100_000 + Math.floor(Math.random() * 800_000);
    await prisma.financeSettings.upsert({
      where: { tenant_id: tenantId },
      update: { next_workshop_order_number: workshopOrderStart },
      create: {
        tenant_id: tenantId,
        workshop_order_prefix: `WO-${new Date().getFullYear()}-`,
        next_workshop_order_number: workshopOrderStart,
      },
    });
    legalEntityId = (
      await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantId },
        select: { id: true },
      })
    ).id;

    const otherTenant = await createTestTenant(
      basePrisma,
      'workshop-estimate-pdf-other',
    );
    otherTenantId = otherTenant.tenantId;
    otherAdminToken = createTestAuthToken(app.get(AuthService), otherTenant);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Anna',
        last_name: 'Beispiel',
        email: `kv-pdf-${Date.now()}@example.com`,
        type: 'PRIVATE',
        address_street: 'Hauptstraße 2',
        address_zip: '8010',
        address_city: 'Graz',
        address_country: 'AT',
      },
    });
    customerId = customer.id;

    // The renderer runs for real except for the PDF bytes, so the render count and
    // the logo input can be asserted. Outside production the send renders inline.
    const renderer = app.get(WorkshopEstimatePdfRenderer);
    renderSpy = jest
      .spyOn(renderer, 'render')
      .mockImplementation(async () => PDF_BYTES);
    logoReadSpy = jest
      .spyOn(app.get(DocumentBrandingAssetStorage), 'readGeneration')
      .mockImplementation(async () => LOGO_BYTES);
  });

  beforeEach(() => {
    process.env[SEND_FLAG] = 'true';
    renderSpy.mockClear();
    logoReadSpy.mockClear();
  });

  afterAll(async () => {
    restoreEnv(SEND_FLAG, previousSendFlag);
    restoreEnv(WRITER_FLAG, previousWriterFlag);
    restoreEnv('CLOUD_TASKS_WORKER_SECRET', previousWorkerSecret);
    await cleanupTestUsers(basePrisma, createdUserIds);
    await teardownTestApp(app, basePrisma);
  });

  it('renders the archive once when the estimate is sent, and serves the same bytes afterwards', async () => {
    const versionId = await createDraftEstimate();
    const rendersBefore = renderSpy.mock.calls.length;

    const sent = await sendVersion(versionId);
    expect(sent.body).toMatchObject({ status: 'SENT' });
    expect(renderSpy.mock.calls.length).toBe(rendersBefore + 1);
    // No branding profile yet: the frozen snapshot has no logo.
    expect(latestRender().logoPng).toBeUndefined();

    await api()
      .post(`/api/workshop/estimates/${versionId}/pdf`)
      .set(adminAuth())
      .expect(201)
      .expect({ message: 'PDF is ready', enqueued: false });
    expect(renderSpy.mock.calls.length).toBe(rendersBefore + 1);

    const download = await getPdf(versionId).expect(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toMatch(
      /^inline; filename="Kostenvoranschlag-KV-[^"]+-v1\.pdf"$/,
    );
    expect((download.body as Buffer).equals(PDF_BYTES)).toBe(true);

    const stored = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: {
        snapshot_sha256: true,
        pdf_storage_key: true,
        pdf_sha256: true,
        pdf_generation_error: true,
      },
    });
    expect(stored.pdf_storage_key).toBe(
      `workshop-estimates/${tenantId}/${versionId}/${stored.snapshot_sha256}.pdf`,
    );
    expect(stored.pdf_sha256).toBe(sha256(PDF_BYTES));
    expect(stored.pdf_generation_error).toBeNull();
  });

  it('keeps a sent estimate when the render fails, records the safe error, and a retry produces the archive', async () => {
    const versionId = await createDraftEstimate();
    renderSpy.mockImplementationOnce(async () => {
      throw new Error('renderer offline');
    });

    const sent = await sendVersion(versionId);
    expect(sent.body).toMatchObject({ status: 'SENT' });

    await getPdf(versionId).expect(404);
    const failed = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { pdf_storage_key: true, pdf_generation_error: true },
    });
    expect(failed).toEqual({ pdf_storage_key: null, pdf_generation_error: SAFE_ERROR });

    await api()
      .post(`/api/workshop/estimates/${versionId}/pdf`)
      .set(adminAuth())
      .expect(201)
      .expect({ message: 'PDF is ready', enqueued: false });

    const download = await getPdf(versionId).expect(200);
    expect((download.body as Buffer).equals(PDF_BYTES)).toBe(true);
    const recovered = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { pdf_generation_error: true },
    });
    expect(recovered.pdf_generation_error).toBeNull();
  });

  it('lets the Cloud Tasks worker render a sent version without an archive, and never render it twice', async () => {
    const versionId = await createDraftEstimate();
    renderSpy.mockImplementationOnce(async () => {
      throw new Error('renderer offline');
    });
    await sendVersion(versionId);
    await getPdf(versionId).expect(404);
    const rendersBefore = renderSpy.mock.calls.length;

    await postWorker(versionId, signedTask('workshop-estimate', versionId)).expect(204);
    expect(renderSpy.mock.calls.length).toBe(rendersBefore + 1);

    // A second delivery of the same task finds the archive and does nothing.
    await postWorker(versionId, signedTask('workshop-estimate', versionId)).expect(204);
    expect(renderSpy.mock.calls.length).toBe(rendersBefore + 1);

    const download = await getPdf(versionId).expect(200);
    expect((download.body as Buffer).equals(PDF_BYTES)).toBe(true);
  });

  it('refuses worker calls with a missing or wrong secret, a different task kind, another resource, a bad signature, or another tenant', async () => {
    const versionId = await createDraftEstimate();
    await sendVersion(versionId);
    const rendersBefore = renderSpy.mock.calls.length;
    const valid = signedTask('workshop-estimate', versionId);

    await api()
      .post(`/api/workshop/estimates/${versionId}/pdf/worker`)
      .send(valid)
      .expect(401);
    await api()
      .post(`/api/workshop/estimates/${versionId}/pdf/worker`)
      .set('x-cloud-tasks-secret', 'not-the-secret')
      .send(valid)
      .expect(401);
    await postWorker(versionId, signedTask('workshop-order', versionId)).expect(403);
    await postWorker(versionId, signedTask('workshop-estimate', randomUUID())).expect(403);
    await postWorker(versionId, { ...valid, signature: '0'.repeat(64) }).expect(401);
    await postWorker(
      versionId,
      signedTask('workshop-estimate', versionId, otherTenantId),
    ).expect(404);

    expect(renderSpy.mock.calls.length).toBe(rendersBefore);
  });

  it('keeps a DRAFT estimate out of the PDF pipeline', async () => {
    const versionId = await createDraftEstimate();
    const rendersBefore = renderSpy.mock.calls.length;

    const refused = await api()
      .post(`/api/workshop/estimates/${versionId}/pdf`)
      .set(adminAuth())
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'ESTIMATE_PDF_NOT_SENT' });
    await getPdf(versionId).expect(404);
    await postWorker(versionId, signedTask('workshop-estimate', versionId)).expect(409);

    expect(renderSpy.mock.calls.length).toBe(rendersBefore);
  });

  it('refuses a TECH session and another tenant on the PDF request and the download', async () => {
    const versionId = await createDraftEstimate();
    await sendVersion(versionId);
    const tech = { Authorization: `Bearer ${await createTechToken()}` };
    const other = { Authorization: `Bearer ${otherAdminToken}` };

    await api().post(`/api/workshop/estimates/${versionId}/pdf`).set(tech).expect(403);
    await api()
      .get(`/api/workshop/estimates/${versionId}/pdf`)
      .set(tech)
      .expect(403);
    await api().post(`/api/workshop/estimates/${versionId}/pdf`).set(other).expect(404);
    await getPdf(versionId, otherAdminToken).expect(404);
  });

  it('pins the frozen logo at send and renders it from the verified bytes', async () => {
    const objectKey = `logos/${tenantId}/${randomUUID()}.png`;
    const asset = await prisma.documentBrandAsset.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        purpose: 'LOGO',
        state: 'READY',
        bucket: 'e2e-brand-assets',
        object_key: objectKey,
        object_generation: '17',
        sha256: sha256(LOGO_BYTES),
        byte_length: LOGO_BYTES.length,
        detected_mime_type: 'image/png',
        pixel_width: 120,
        pixel_height: 40,
      },
    });
    await prisma.documentBrandProfile.deleteMany({
      where: { legal_entity_id: legalEntityId },
    });
    await prisma.documentBrandProfile.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        active_revision: 1,
        active_theme: {
          ...DEFAULT_DOCUMENT_BRAND_THEME,
          logoAssetId: asset.id,
          headerBand: 'primary',
          footerBand: 'secondary',
          headerText: 'Musterwerkstatt',
          footerText: 'Musterwerkstatt GmbH',
        },
        active_logo_asset_id: asset.id,
      },
    });

    const versionId = await createDraftEstimate();
    const sent = await sendVersion(versionId);
    expect(sent.body).toMatchObject({ status: 'SENT' });

    expect(latestRender().logoPng?.equals(LOGO_BYTES)).toBe(true);
    expect(logoReadSpy).toHaveBeenCalledWith('e2e-brand-assets', objectKey, '17');
    const reference = await prisma.workshopEstimateBrandAssetReference.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
      select: { asset_id: true, legal_entity_id: true },
    });
    expect(reference).toEqual({ asset_id: asset.id, legal_entity_id: legalEntityId });

    const download = await getPdf(versionId).expect(200);
    expect((download.body as Buffer).equals(PDF_BYTES)).toBe(true);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
