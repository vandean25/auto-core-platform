import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from '../src/document-branding/document-branding-asset-storage.js';
import { DocumentBrandingExtractionImageProcessor } from '../src/document-branding/document-branding-extraction-image-processor.js';
import { DocumentBrandingExtractionWorkerService } from '../src/document-branding/document-branding-extraction-worker.service.js';
import {
  DOCUMENT_BRAND_EXTRACTION_PROVIDER,
  type DocumentBrandingExtractionProvider,
} from '../src/document-branding/document-branding-extraction-provider.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { seedInvoiceReadyCustomer, seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import {
  confirmDocumentBrandTheme,
  exerciseFrozenInvoiceArchiveLifecycle,
  installFakeInvoiceArchiveStorage,
} from './invoice-branding-archive-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Document branding extraction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  const sourceBytes = Buffer.from('normalized-source-image');
  const provider: DocumentBrandingExtractionProvider & {
    isAvailable: jest.Mock;
    getMetadata: jest.Mock;
    extract: jest.Mock;
  } = {
    isAvailable: jest.fn().mockReturnValue(false),
    getMetadata: jest.fn().mockReturnValue({
      providerId: 'mock-provider',
      modelId: 'mock-model',
    }),
    extract: jest.fn(),
  };
  const storage = {
    readGeneration: jest.fn().mockResolvedValue(sourceBytes),
    storeImmutable: jest.fn().mockResolvedValue({
      bucket: 'aut324-test',
      generation: '2',
    }),
    deleteGeneration: jest.fn().mockResolvedValue(undefined),
  };
  const imageProcessor = {
    normalizePng: jest
      .fn()
      .mockResolvedValue({ bytes: sourceBytes, width: 2, height: 2 }),
    cropLogo: jest
      .fn()
      .mockResolvedValue({ bytes: sourceBytes, width: 2, height: 2 }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DOCUMENT_BRAND_EXTRACTION_PROVIDER)
      .useValue(provider)
      .overrideProvider(DocumentBrandingAssetStorage)
      .useValue(storage)
      .overrideProvider(DocumentBrandingExtractionImageProcessor)
      .useValue(imageProcessor)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    installFakeInvoiceArchiveStorage(app, sourceBytes);

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
  });

  beforeEach(async () => {
    provider.isAvailable.mockReturnValue(false);
    provider.getMetadata.mockReturnValue({
      providerId: 'mock-provider',
      modelId: 'mock-model',
    });
    provider.extract.mockReset();
    storage.readGeneration.mockClear();
    storage.storeImmutable.mockClear();
    storage.deleteGeneration.mockClear();
    tenant = await createTestTenant(prisma, 'aut324-extraction');
  });

  afterEach(async () => {
    if (!tenant) return;
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    await tenantPrisma.documentBrandProfile.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
    await tenantPrisma.documentBrandExtraction.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
    await tenantPrisma.invoiceBrandAssetReference.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
    await tenantPrisma.documentBrandAsset.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
    await tenantPrisma.documentBrandQuotaEvent.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
    await tenantPrisma.documentBrandQuotaLock.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
    await cleanupTestTenantGraph(prisma, tenant.tenantId).catch(
      () => undefined,
    );
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  it('enforces one active extraction per legal entity', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const source = await tenantPrisma.documentBrandAsset.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: entity.id,
        purpose: 'SOURCE',
        state: 'READY',
        bucket: 'aut324-test',
        object_key: `source/${tenant.tenantId}/active-job.pdf`,
        object_generation: '1',
        sha256: 'b'.repeat(64),
        byte_length: 128,
        detected_mime_type: 'application/pdf',
      },
    });
    const extraction = {
      tenant_id: tenant.tenantId,
      legal_entity_id: entity.id,
      source_asset_id: source.id,
      base_revision: 0,
      request_hash: 'c'.repeat(64),
    };

    await tenantPrisma.documentBrandExtraction.create({
      data: { ...extraction, idempotency_key: 'aut324-active-1' },
    });

    await expect(
      tenantPrisma.documentBrandExtraction.create({
        data: { ...extraction, idempotency_key: 'aut324-active-2' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('prevents an extraction from referencing a source in another legal entity', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const [entity, foreignEntity] = await Promise.all([
      tenantPrisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenant.tenantId },
      }),
      tenantPrisma.legalEntity.create({
        data: {
          tenant_id: tenant.tenantId,
          name: `AUT-324 Foreign Source ${tenant.tenantId}`,
          country_iso: 'AT',
          is_active: true,
        },
      }),
    ]);
    const foreignSource = await tenantPrisma.documentBrandAsset.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: foreignEntity.id,
        purpose: 'SOURCE',
        state: 'READY',
        bucket: 'aut324-test',
        object_key: `source/${tenant.tenantId}/foreign.pdf`,
        object_generation: '1',
        sha256: 'd'.repeat(64),
        byte_length: 128,
        detected_mime_type: 'application/pdf',
      },
    });

    await expect(
      tenantPrisma.documentBrandExtraction.create({
        data: {
          tenant_id: tenant.tenantId,
          legal_entity_id: entity.id,
          source_asset_id: foreignSource.id,
          base_revision: 0,
          idempotency_key: 'aut324-foreign-source',
          request_hash: 'e'.repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('reports extraction unavailable and preserves manual branding when the provider is disabled', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const source = await tenantPrisma.documentBrandAsset.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: entity.id,
        purpose: 'SOURCE',
        state: 'READY',
        bucket: 'aut324-test',
        object_key: `source/${tenant.tenantId}/letterhead.pdf`,
        object_generation: '1',
        sha256: 'a'.repeat(64),
        byte_length: 128,
        detected_mime_type: 'application/pdf',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const authToken = createTestAuthToken(authService, tenant);

    const profile = await request(app.getHttpServer())
      .get(baseUrl)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(profile.body.capabilities.extractionAvailable).toBe(false);

    const unavailable = await request(app.getHttpServer())
      .post(`${baseUrl}/extractions`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-disabled-provider')
      .send({ sourceAssetId: source.id, expectedRevision: 0 })
      .expect(503);

    expect(unavailable.body.code).toBe('BRAND_EXTRACTION_UNAVAILABLE');

    const unchangedProfile = await request(app.getHttpServer())
      .get(baseUrl)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(unchangedProfile.body).toMatchObject({
      revision: 0,
      activeRevision: 0,
      draftTheme: null,
      capabilities: { extractionAvailable: false },
    });
    await expect(
      tenantPrisma.documentBrandAsset.count({
        where: {
          tenant_id: tenant.tenantId,
          legal_entity_id: entity.id,
          purpose: 'SOURCE',
        },
      }),
    ).resolves.toBe(1);
  });

  it('runs a mock extraction through proposal application and explicit confirmation', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const source = await tenantPrisma.documentBrandAsset.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: entity.id,
        purpose: 'SOURCE',
        state: 'READY',
        bucket: 'aut324-test',
        object_key: `source/${tenant.tenantId}/mock.png`,
        object_generation: '1',
        sha256: 'f'.repeat(64),
        byte_length: sourceBytes.byteLength,
        detected_mime_type: 'image/png',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    provider.isAvailable.mockReturnValue(true);
    provider.extract.mockResolvedValue({
      confidence: 'SUFFICIENT',
      theme: {
        schemaVersion: 1,
        presetId: 'standard-v1',
        primaryColor: '#123456',
        secondaryColor: '#E5E7EB',
        fontId: 'acp-sans-v1',
        headerBand: 'none',
        footerBand: 'none',
        headerText: 'Mock Letterhead',
        footerText: '',
      },
      warningCodes: [],
      cropRect: null,
    });
    const authToken = createTestAuthToken(authService, tenant);
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/extractions`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-mock-extraction')
      .send({ sourceAssetId: source.id, expectedRevision: 0 })
      .expect(202);

    await runWithTenantContext(tenant.tenantId, () =>
      app
        .get(DocumentBrandingExtractionWorkerService)
        .process(created.body.id, entity.id, tenant.tenantId, 0),
    );

    const ready = await request(app.getHttpServer())
      .get(`${baseUrl}/extractions/${created.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(ready.body).toMatchObject({
      state: 'SUCCEEDED',
      proposal: { headerText: 'Mock Letterhead', logoAssetId: expect.any(String) },
    });
    const persistedExtraction = await tenantPrisma.documentBrandExtraction.findFirstOrThrow({
      where: { id: created.body.id, tenant_id: tenant.tenantId },
      select: { provider_id: true, model_id: true },
    });
    expect(persistedExtraction).toEqual({
      provider_id: 'mock-provider',
      model_id: 'mock-model',
    });

    const draft = await request(app.getHttpServer())
      .put(`${baseUrl}/draft`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedRevision: 0,
        extractionId: created.body.id,
        theme: ready.body.proposal,
      })
      .expect(200);
    expect(draft.body).toMatchObject({
      activeRevision: 0,
      activeTheme: expect.objectContaining({ logoAssetId: null }),
      draftTheme: expect.objectContaining({ headerText: 'Mock Letterhead' }),
    });

    const confirmed = await request(app.getHttpServer())
      .post(`${baseUrl}/confirm`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'd2815ffb-0f88-4f2f-9049-3e9d324071fe')
      .send({ expectedRevision: draft.body.revision })
      .expect(200);
    expect(confirmed.body).toMatchObject({
      activeRevision: 2,
      activeTheme: expect.objectContaining({ headerText: 'Mock Letterhead' }),
      draftTheme: null,
    });
    await request(app.getHttpServer())
      .post(`${baseUrl}/extractions/${created.body.id}/discard`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('DISCARDED'));
    const profileAfterDiscard = await request(app.getHttpServer())
      .get(baseUrl)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(profileAfterDiscard.body.activeTheme.headerText).toBe('Mock Letterhead');
  });

  it('discards queued and running jobs through the API', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const authToken = createTestAuthToken(authService, tenant);
    provider.isAvailable.mockReturnValue(true);
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const createJob = async (key: string) => {
      const source = await createReadyExtractionSource(
        {
          prisma: tenantPrisma,
          tenantId: tenant.tenantId,
          legalEntityId: entity.id,
          suffix: key,
          mimeType: 'image/png',
        },
      );
      const response = await request(app.getHttpServer())
        .post(`${baseUrl}/extractions`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', key)
        .send({ sourceAssetId: source.id, expectedRevision: 0 })
        .expect(202);
      return response.body.id as string;
    };

    const queuedId = await createJob('aut324-discard-queued');
    await request(app.getHttpServer())
      .post(`${baseUrl}/extractions/${queuedId}/discard`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('DISCARDED'));

    const runningId = await createJob('aut324-discard-running');
    await tenantPrisma.documentBrandExtraction.updateMany({
      where: { id: runningId, tenant_id: tenant.tenantId },
      data: {
        state: 'RUNNING',
        attempt_count: 1,
        lease_token: 'aut324-test-lease',
        lease_until: new Date(Date.now() + 60_000),
      },
    });
    await request(app.getHttpServer())
      .post(`${baseUrl}/extractions/${runningId}/discard`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('DISCARDED'));
  });

  it('keeps active branding unchanged when an extraction times out', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const authToken = createTestAuthToken(authService, tenant);
    const headerText = 'Active branding before timeout';
    await confirmDocumentBrandTheme({
      app,
      authToken,
      legalEntityId: entity.id,
      logoAssetId: null,
      headerText,
    });
    const activeThemeBeforeTimeout = (
      await tenantPrisma.documentBrandProfile.findFirstOrThrow({
        where: { tenant_id: tenant.tenantId, legal_entity_id: entity.id },
        select: { active_theme: true },
      })
    ).active_theme;
    const source = await createReadyExtractionSource(
      {
        prisma: tenantPrisma,
        tenantId: tenant.tenantId,
        legalEntityId: entity.id,
        suffix: 'timeout',
        mimeType: 'image/png',
      },
    );
    provider.isAvailable.mockReturnValue(true);
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/extractions`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-timeout')
      .send({ sourceAssetId: source.id, expectedRevision: 2 })
      .expect(202);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(50_000);
    try {
      await runWithTenantContext(tenant.tenantId, () =>
        app
          .get(DocumentBrandingExtractionWorkerService)
          .process(created.body.id, entity.id, tenant.tenantId, 0),
      );
    } finally {
      now.mockRestore();
    }

    const [job, profile] = await Promise.all([
      tenantPrisma.documentBrandExtraction.findFirstOrThrow({
        where: { id: created.body.id, tenant_id: tenant.tenantId },
      }),
      tenantPrisma.documentBrandProfile.findFirstOrThrow({
        where: { tenant_id: tenant.tenantId, legal_entity_id: entity.id },
      }),
    ]);
    expect(job.state).toBe('QUEUED');
    expect(profile.active_theme).toEqual(activeThemeBeforeTimeout);
  });

  it('rejects an unsafe PDF and preserves the active profile', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const authToken = createTestAuthToken(authService, tenant);
    await confirmDocumentBrandTheme({
      app,
      authToken,
      legalEntityId: entity.id,
      logoAssetId: null,
      headerText: 'Protected active branding',
    });
    const source = await createReadyExtractionSource(
      {
        prisma: tenantPrisma,
        tenantId: tenant.tenantId,
        legalEntityId: entity.id,
        suffix: 'unsafe-pdf',
        mimeType: 'application/pdf',
      },
    );
    provider.isAvailable.mockReturnValue(true);
    storage.readGeneration.mockResolvedValueOnce(
      Buffer.from('%PDF-1.7 /Encrypt'),
    );
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/extractions`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-unsafe-pdf')
      .send({ sourceAssetId: source.id, expectedRevision: 2 })
      .expect(202);

    await runWithTenantContext(tenant.tenantId, () =>
      app
        .get(DocumentBrandingExtractionWorkerService)
        .process(created.body.id, entity.id, tenant.tenantId, 0),
    );

    const [job, profile] = await Promise.all([
      tenantPrisma.documentBrandExtraction.findFirstOrThrow({
        where: { id: created.body.id, tenant_id: tenant.tenantId },
      }),
      tenantPrisma.documentBrandProfile.findFirstOrThrow({
        where: { tenant_id: tenant.tenantId, legal_entity_id: entity.id },
      }),
    ]);
    expect(job).toMatchObject({ state: 'FAILED', failure_code: 'BRAND_PDF_ENCRYPTED' });
    expect(profile.active_theme).toMatchObject({ headerText: 'Protected active branding' });
  });

  it('fails closed when the requesting admin membership is revoked', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const authToken = createTestAuthToken(authService, tenant);
    await confirmDocumentBrandTheme({
      app,
      authToken,
      legalEntityId: entity.id,
      logoAssetId: null,
      headerText: 'Protected active branding',
    });
    const source = await createReadyExtractionSource(
      {
        prisma: tenantPrisma,
        tenantId: tenant.tenantId,
        legalEntityId: entity.id,
        suffix: 'revoked-requester',
        mimeType: 'image/png',
      },
    );
    provider.isAvailable.mockReturnValue(true);
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/extractions`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-revoked-requester')
      .send({ sourceAssetId: source.id, expectedRevision: 2 })
      .expect(202);
    const user = await tenantPrisma.user.findUniqueOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    await tenantPrisma.tenantMember.updateMany({
      where: { tenant_id: tenant.tenantId, user_id: user.id },
      data: { is_active: false },
    });

    await runWithTenantContext(tenant.tenantId, () =>
      app
        .get(DocumentBrandingExtractionWorkerService)
        .process(created.body.id, entity.id, tenant.tenantId, 0),
    );

    const [job, profile] = await Promise.all([
      tenantPrisma.documentBrandExtraction.findFirstOrThrow({
        where: { id: created.body.id, tenant_id: tenant.tenantId },
      }),
      tenantPrisma.documentBrandProfile.findFirstOrThrow({
        where: { tenant_id: tenant.tenantId, legal_entity_id: entity.id },
      }),
    ]);
    expect(job).toMatchObject({ state: 'FAILED', failure_code: 'BRAND_REQUESTER_REVOKED' });
    expect(profile.active_theme).toMatchObject({ headerText: 'Protected active branding' });
  });

  it('rejects applying an expired proposal', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const authToken = createTestAuthToken(authService, tenant);
    const source = await createReadyExtractionSource(
      {
        prisma: tenantPrisma,
        tenantId: tenant.tenantId,
        legalEntityId: entity.id,
        suffix: 'expired-proposal',
        mimeType: 'image/png',
      },
    );
    provider.isAvailable.mockReturnValue(true);
    provider.extract.mockResolvedValue({
      confidence: 'SUFFICIENT',
      theme: {
        schemaVersion: 1,
        presetId: 'standard-v1',
        primaryColor: '#123456',
        secondaryColor: '#E5E7EB',
        fontId: 'acp-sans-v1',
        headerBand: 'none',
        footerBand: 'none',
        headerText: 'Expired proposal',
        footerText: '',
      },
      warningCodes: [],
      cropRect: null,
    });
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/extractions`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-expired-proposal')
      .send({ sourceAssetId: source.id, expectedRevision: 0 })
      .expect(202);
    await runWithTenantContext(tenant.tenantId, () =>
      app
        .get(DocumentBrandingExtractionWorkerService)
        .process(created.body.id, entity.id, tenant.tenantId, 0),
    );
    const proposal = await tenantPrisma.documentBrandExtraction.findFirstOrThrow({
      where: { id: created.body.id, tenant_id: tenant.tenantId },
      select: { proposal: true },
    });
    await tenantPrisma.documentBrandExtraction.updateMany({
      where: { id: created.body.id, tenant_id: tenant.tenantId },
      data: { expires_at: new Date(Date.now() - 1) },
    });

    await request(app.getHttpServer())
      .put(`${baseUrl}/draft`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedRevision: 0,
        extractionId: created.body.id,
        theme: proposal.proposal,
      })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('BRAND_EXTRACTION_STALE'));
    const profile = await tenantPrisma.documentBrandProfile.findFirst({
      where: { tenant_id: tenant.tenantId, legal_entity_id: entity.id },
    });
    expect(profile?.active_theme ?? null).toBeNull();
  });

  it('freezes an extracted logo in the newly issued invoice archive after profile changes', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    await seedReadySellerAndAccountingProfile(tenantPrisma, tenant.tenantId);
    const customer = await seedInvoiceReadyCustomer(tenantPrisma, tenant.tenantId);
    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenant.tenantId,
        sku: `AUT324-${tenant.tenantId}`,
        name: 'Document Branding E2E Item',
        cost_price: 10,
        retail_price: 20,
      },
    });
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const location = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        code: `AUT324-${tenant.tenantId}`,
        name: 'AUT-324 E2E Location',
        type: 'warehouse',
        site_id: siteId,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        tenant_id: tenant.tenantId,
        catalog_item_id: catalogItem.id,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 100,
      },
    });
    const source = await createReadyExtractionSource(
      {
        prisma: tenantPrisma,
        tenantId: tenant.tenantId,
        legalEntityId: entity.id,
        suffix: 'invoice-logo',
        mimeType: 'image/png',
      },
    );
    provider.isAvailable.mockReturnValue(true);
    provider.extract.mockResolvedValue({
      confidence: 'SUFFICIENT',
      theme: {
        schemaVersion: 1,
        presetId: 'standard-v1',
        primaryColor: '#123456',
        secondaryColor: '#E5E7EB',
        fontId: 'acp-sans-v1',
        headerBand: 'none',
        footerBand: 'none',
        headerText: 'Extracted invoice letterhead',
        footerText: '',
      },
      warningCodes: [],
      cropRect: null,
    });
    const authToken = createTestAuthToken(authService, tenant);
    const brandUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const created = await request(app.getHttpServer())
      .post(`${brandUrl}/extractions`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-invoice-extraction')
      .send({ sourceAssetId: source.id, expectedRevision: 0 })
      .expect(202);
    await runWithTenantContext(tenant.tenantId, () =>
      app
        .get(DocumentBrandingExtractionWorkerService)
        .process(created.body.id, entity.id, tenant.tenantId, 0),
    );
    const extraction = await tenantPrisma.documentBrandExtraction.findFirstOrThrow({
      where: { id: created.body.id, tenant_id: tenant.tenantId },
      select: { proposal: true },
    });
    const logoAssetId = (extraction.proposal as { logoAssetId: string }).logoAssetId;
    const draft = await request(app.getHttpServer())
      .put(`${brandUrl}/draft`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedRevision: 0, extractionId: created.body.id, theme: extraction.proposal })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${brandUrl}/confirm`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut324-invoice-confirm')
      .send({ expectedRevision: draft.body.revision })
      .expect(200);

    const order = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customer.id,
        items: [
          {
            catalog_item_id: catalogItem.id,
            description: 'Document branding invoice item',
            quantity: 1,
            unit_price: 100,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);
    await tenantPrisma.salesOrder.updateMany({
      where: { id: order.body.id, tenant_id: tenant.tenantId },
      data: { status: 'CONFIRMED' },
    });
    const invoice = await request(app.getHttpServer())
      .post(`/api/sales-orders/${order.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    const committed = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoice.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const frozen = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoice.body.id, tenant_id: tenant.tenantId },
      select: { snapshot: true },
    });
    expect((frozen.snapshot as { branding: { logo: { asset_id: string } } }).branding.logo.asset_id).toBe(logoAssetId);
    expect(committed.body.status).toBe('FINALIZED');

    await exerciseFrozenInvoiceArchiveLifecycle({
      app,
      prisma: tenantPrisma,
      authToken,
      invoiceId: invoice.body.id,
      legalEntityId: entity.id,
      logoAssetId,
    });
  });
});

async function createReadyExtractionSource(
  params: {
    prisma: PrismaService;
    tenantId: string;
    legalEntityId: string;
    suffix: string;
    mimeType: string;
  },
) {
  return params.prisma.documentBrandAsset.create({
    data: {
      tenant_id: params.tenantId,
      legal_entity_id: params.legalEntityId,
      purpose: 'SOURCE',
      state: 'READY',
      bucket: 'aut324-test',
      object_key: `source/${params.tenantId}/${params.suffix}`,
      object_generation: '1',
      sha256: 'a'.repeat(64),
      byte_length: 128,
      detected_mime_type: params.mimeType,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}
