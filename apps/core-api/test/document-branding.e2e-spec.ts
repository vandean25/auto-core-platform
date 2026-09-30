import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Document branding persistence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
  });

  beforeEach(async () => {
    tenantA = await createTestTenant(prisma, 'aut322-ta');
    tenantB = await createTestTenant(prisma, 'aut322-tb');
  });

  afterEach(async () => {
    for (const tenant of [tenantA, tenantB]) {
      if (!tenant) continue;
      const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
      await tenantPrisma.documentBrandProfile.deleteMany({
        where: { tenant_id: tenant.tenantId },
      });
      await tenantPrisma.documentBrandAsset.deleteMany({
        where: { tenant_id: tenant.tenantId },
      });
      await cleanupTestTenantGraph(prisma, tenant.tenantId).catch(
        () => undefined,
      );
    }
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  it('allows only one profile per legal entity and rejects foreign-entity assets', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const ownEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const foreignEntity = await createTenantAwarePrisma(
      prisma,
      tenantB.tenantId,
    ).legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantB.tenantId },
    });

    await tenantPrisma.documentBrandProfile.create({
      data: { tenant_id: tenantA.tenantId, legal_entity_id: ownEntity.id },
    });

    await expect(
      tenantPrisma.documentBrandProfile.create({
        data: { tenant_id: tenantA.tenantId, legal_entity_id: ownEntity.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      tenantPrisma.documentBrandProfile.create({
        data: {
          tenant_id: tenantA.tenantId,
          legal_entity_id: foreignEntity.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a logo owned by a different legal entity', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const firstEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const secondEntity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `AUT-322 Other Entity ${tenantA.tenantId}`,
        country_iso: 'AT',
        is_active: true,
      },
    });
    const asset = await tenantPrisma.documentBrandAsset.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: firstEntity.id,
        purpose: 'LOGO',
        state: 'READY',
        bucket: 'aut322-test',
        object_key: `logo/${tenantA.tenantId}.png`,
        object_generation: '1',
        sha256: 'a'.repeat(64),
        byte_length: 1,
        detected_mime_type: 'image/png',
      },
    });

    await expect(
      tenantPrisma.documentBrandProfile.create({
        data: {
          tenant_id: tenantA.tenantId,
          legal_entity_id: secondEntity.id,
          active_logo_asset_id: asset.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('isolates profiles and asset routes across tenants and legal entities', async () => {
    const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);
    const tenantAEntity = await tenantAPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const sameTenantOtherEntity = await tenantAPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `AUT-322 Isolation ${tenantA.tenantId}`,
        country_iso: 'AT',
        is_active: true,
      },
    });
    const tenantBEntity = await tenantBPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantB.tenantId },
    });
    const createReadyLogo = (tenantId: string, legalEntityId: string) =>
      createTenantAwarePrisma(prisma, tenantId).documentBrandAsset.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          purpose: 'LOGO',
          state: 'READY',
          bucket: 'aut322-test',
          object_key: `logo/${tenantId}/${legalEntityId}.png`,
          object_generation: '1',
          sha256: 'a'.repeat(64),
          byte_length: 1,
          detected_mime_type: 'image/png',
        },
      });
    const tenantBLogo = await createReadyLogo(
      tenantB.tenantId,
      tenantBEntity.id,
    );
    const sameTenantLogo = await createReadyLogo(
      tenantA.tenantId,
      sameTenantOtherEntity.id,
    );
    const token = createTestAuthToken(authService, tenantA);
    const baseUrl = `/api/legal-entities/${tenantAEntity.id}/document-branding`;

    await request(app.getHttpServer())
      .get(`/api/legal-entities/${tenantBEntity.id}/document-branding`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    for (const asset of [tenantBLogo, sameTenantLogo]) {
      await request(app.getHttpServer())
        .get(`${baseUrl}/assets/${asset.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`${baseUrl}/assets/${asset.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    }

    const defaultTheme = {
      schemaVersion: 1,
      presetId: 'standard-v1',
      logoAssetId: sameTenantLogo.id,
      primaryColor: '#111827',
      secondaryColor: '#E5E7EB',
      fontId: 'acp-sans-v1',
      headerBand: 'none',
      footerBand: 'none',
      headerText: '',
      footerText: '',
    };
    await request(app.getHttpServer())
      .put(`${baseUrl}/draft`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedRevision: 0, theme: defaultTheme })
      .expect(404);
  });

  it('blocks legal entity deletion while a branding profile is retained', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `AUT-322 Retained Entity ${tenantA.tenantId}`,
        country_iso: 'AT',
        is_active: true,
      },
    });
    await tenantPrisma.documentBrandProfile.create({
      data: { tenant_id: tenantA.tenantId, legal_entity_id: entity.id },
    });

    const response = await request(app.getHttpServer())
      .delete(`/api/legal-entities/${entity.id}`)
      .set(
        'Authorization',
        `Bearer ${createTestAuthToken(authService, tenantA)}`,
      )
      .expect(409);

    expect(response.body.message).toContain(
      'document-branding data is retained',
    );
  });

  it('supports manual draft, explicit confirmation, idempotent retry and default reset', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const authToken = createTestAuthToken(authService, tenantA);
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const defaultTheme = {
      schemaVersion: 1,
      presetId: 'standard-v1',
      logoAssetId: null,
      primaryColor: '#111827',
      secondaryColor: '#E5E7EB',
      fontId: 'acp-sans-v1',
      headerBand: 'none',
      footerBand: 'none',
      headerText: '',
      footerText: '',
    };

    const initial = await request(app.getHttpServer())
      .get(baseUrl)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(initial.body).toMatchObject({
      revision: 0,
      activeRevision: 0,
      activeTheme: defaultTheme,
      draftTheme: null,
    });

    const draftTheme = { ...defaultTheme, headerText: 'Auto Core' };
    const saved = await request(app.getHttpServer())
      .put(`${baseUrl}/draft`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedRevision: 0, theme: draftTheme })
      .expect(200);
    expect(saved.body).toMatchObject({
      revision: 1,
      activeRevision: 0,
      draftTheme,
    });

    const confirm = await request(app.getHttpServer())
      .post(`${baseUrl}/confirm`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut322-confirm-1')
      .send({ expectedRevision: 1 })
      .expect(200);
    expect(confirm.body).toMatchObject({
      revision: 2,
      activeRevision: 2,
      activeTheme: draftTheme,
      draftTheme: null,
    });

    const retry = await request(app.getHttpServer())
      .post(`${baseUrl}/confirm`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut322-confirm-1')
      .send({ expectedRevision: 1 })
      .expect(200);
    expect(retry.body).toEqual(confirm.body);

    const reset = await request(app.getHttpServer())
      .post(`${baseUrl}/reset`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'aut322-reset-1')
      .send({ expectedRevision: 2 })
      .expect(200);
    expect(reset.body).toMatchObject({
      revision: 3,
      activeRevision: 3,
      activeTheme: defaultTheme,
      draftTheme: null,
    });
  });

  it('limits preview to a synthetic sample and rejects non-admin access', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const preview = await request(app.getHttpServer())
      .post(`${baseUrl}/preview`)
      .set(
        'Authorization',
        `Bearer ${createTestAuthToken(authService, tenantA)}`,
      )
      .send({
        theme: {
          schemaVersion: 1,
          presetId: 'standard-v1',
          logoAssetId: null,
          primaryColor: '#111827',
          secondaryColor: '#E5E7EB',
          fontId: 'acp-sans-v1',
          headerBand: 'none',
          footerBand: 'none',
          headerText: '',
          footerText: '',
        },
        sample: 'AT_STANDARD',
      })
      .expect(200);
    expect(preview.body.html).toContain('SAMPLE — NOT AN INVOICE');
    expect(preview.body.html).toContain('RE-2026-0001');

    await tenantPrisma.tenantMember.updateMany({
      where: { tenant_id: tenantA.tenantId },
      data: { role: 'TECH' },
    });

    await request(app.getHttpServer())
      .get(`/api/legal-entities/${entity.id}/document-branding`)
      .set(
        'Authorization',
        `Bearer ${createTestAuthToken(authService, tenantA, { role: 'TECH' })}`,
      )
      .expect(403);
  });

  it('persists a draft letterhead source on the profile until it is removed', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const authToken = createTestAuthToken(authService, tenantA);
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;
    const source = await tenantPrisma.documentBrandAsset.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: entity.id,
        purpose: 'SOURCE',
        state: 'READY',
        byte_length: 2048,
        detected_mime_type: 'image/png',
        original_filename: 'Letterhead.png',
        bucket: 'brand-bucket',
        object_key: 'source.png',
        object_generation: '1',
        sha256: 'a'.repeat(64),
      },
    });

    const attached = await request(app.getHttpServer())
      .put(`${baseUrl}/draft/source`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedRevision: 0, sourceAssetId: source.id })
      .expect(200);
    expect(attached.body).toMatchObject({
      revision: 1,
      draftSourceAssetId: source.id,
      draftSourceAsset: {
        id: source.id,
        originalFilename: 'Letterhead.png',
        byteLength: 2048,
        state: 'READY',
      },
    });

    const profile = await request(app.getHttpServer())
      .get(baseUrl)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(profile.body.draftSourceAssetId).toBe(source.id);

    const removed = await request(app.getHttpServer())
      .delete(`${baseUrl}/draft/source?expectedRevision=1`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(removed.body).toMatchObject({
      revision: 2,
      draftSourceAssetId: null,
      draftSourceAsset: null,
    });
  });

  it('enforces transactional per-entity upload and per-user preview quotas', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const membership = await tenantPrisma.tenantMember.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
      select: { user_id: true },
    });
    await tenantPrisma.documentBrandQuotaEvent.createMany({
      data: [
        ...Array.from({ length: 20 }, () => ({
          tenant_id: tenantA.tenantId,
          legal_entity_id: entity.id,
          user_id: membership.user_id,
          action: 'ASSET_UPLOAD' as const,
        })),
        ...Array.from({ length: 30 }, () => ({
          tenant_id: tenantA.tenantId,
          user_id: membership.user_id,
          action: 'PREVIEW' as const,
        })),
      ],
    });
    const authToken = createTestAuthToken(authService, tenantA);
    const baseUrl = `/api/legal-entities/${entity.id}/document-branding`;

    await request(app.getHttpServer())
      .post(`${baseUrl}/assets`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('purpose', 'LOGO')
      .attach(
        'file',
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        'logo.png',
      )
      .expect(429);

    await request(app.getHttpServer())
      .post(`${baseUrl}/preview`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        theme: {
          schemaVersion: 1,
          presetId: 'standard-v1',
          logoAssetId: null,
          primaryColor: '#111827',
          secondaryColor: '#E5E7EB',
          fontId: 'acp-sans-v1',
          headerBand: 'none',
          footerBand: 'none',
          headerText: '',
          footerText: '',
        },
        sample: 'AT_STANDARD',
      })
      .expect(429);
  });
});
