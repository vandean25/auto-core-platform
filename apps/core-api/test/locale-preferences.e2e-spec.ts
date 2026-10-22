import { INestApplication } from '@nestjs/common';
import { TenantMemberRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { resolveCustomerDocumentLanguage } from '../src/common/i18n/customer-document-language.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Locale preferences (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenantId: string;
  let token: string;
  let userDbId: string;
  let fixture: TestTenantResult;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    fixture = await createTestTenant(prisma, 'aut576');
    tenantId = fixture.tenantId;
    token = createTestAuthToken(authService, fixture);
    const user = await prisma.user.findFirst({
      where: { firebaseUid: fixture.firebaseUid },
      select: { id: true },
    });
    userDbId = user!.id;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  async function createMemberToken(role: TenantMemberRole): Promise<string> {
    const slug = role.toLowerCase();
    const firebaseUid = `aut576-${slug}-${tenantId}`;
    const email = `${slug}-${tenantId}@example.com`;
    await prisma.user.create({
      data: {
        firebaseUid,
        email,
        active_tenant_id: tenantId,
        memberships: {
          create: { tenant_id: tenantId, role, is_active: true },
        },
      },
    });
    return createTestAuthToken(authService, {
      tenantId,
      firebaseUid,
      email,
      role,
    });
  }

  it('resolves user → tenant → de on preferences and session', async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { default_locale: 'en' },
    });
    await prisma.user.update({
      where: { id: userDbId },
      data: { locale: null },
    });

    const prefs = await request(app.getHttpServer())
      .get('/api/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(prefs.body).toMatchObject({
      locale: null,
      effectiveLocale: 'en',
      defaultLocale: 'en',
      formatLocale: 'de-AT',
    });

    const session = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(session.body.effectiveLocale).toBe('en');
    expect(session.body.defaultLocale).toBe('en');

    await prisma.user.update({
      where: { id: userDbId },
      data: { locale: 'de' },
    });

    const overridden = await request(app.getHttpServer())
      .get('/api/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(overridden.body.effectiveLocale).toBe('de');
  });

  it('persists user locale via PATCH and falls back to de when tenant default is de', async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { default_locale: 'de' },
    });

    const patched = await request(app.getHttpServer())
      .patch('/api/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: null })
      .expect(200);

    expect(patched.body).toMatchObject({
      locale: null,
      effectiveLocale: 'de',
      defaultLocale: 'de',
    });
  });

  it('rejects PATCH preferences without locale and invalid locale values', async () => {
    await request(app.getHttpServer())
      .patch('/api/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'fr' })
      .expect(400);
  });

  it('allows OWNER to update tenant default locale', async () => {
    const settings = await request(app.getHttpServer())
      .patch('/api/tenants/current/locale')
      .set('Authorization', `Bearer ${token}`)
      .send({ default_locale: 'en' })
      .expect(200);

    expect(settings.body).toEqual({
      default_locale: 'en',
      format_locale: 'de-AT',
    });
  });

  it('denies tenant locale PATCH for non-admin roles', async () => {
    const salesToken = await createMemberToken('SALES');
    await request(app.getHttpServer())
      .patch('/api/tenants/current/locale')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ default_locale: 'de' })
      .expect(403);
  });

  it('denies tenant API keys on user preference routes', async () => {
    const keyRes = await request(app.getHttpServer())
      .post('/api/tenant-api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'locale-pref-test', scopes: ['customers:read'] })
      .expect(201);
    const apiKeyAuth = `Bearer ${keyRes.body.token}`;
    await request(app.getHttpServer())
      .get('/api/auth/me/preferences')
      .set('Authorization', apiKeyAuth)
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/auth/me/preferences')
      .set('Authorization', apiKeyAuth)
      .send({ locale: 'de' })
      .expect(403);
  });

  it('resolves customer document language tenant → de when preferred_language is null', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const customer = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenantId,
        type: 'PRIVATE',
        first_name: 'Test',
        last_name: 'Kunde',
      },
    });

    const created = await request(app.getHttpServer())
      .get(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(created.body.preferred_language).toBeNull();

    await request(app.getHttpServer())
      .patch('/api/tenants/current/locale')
      .set('Authorization', `Bearer ${token}`)
      .send({ default_locale: 'en' })
      .expect(200);

    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { default_locale: true },
    });
    expect(
      resolveCustomerDocumentLanguage(
        { preferred_language: customer.preferred_language },
        tenant!.default_locale,
      ),
    ).toBe('en');

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { default_locale: 'de' },
    });
    expect(
      resolveCustomerDocumentLanguage(
        { preferred_language: null },
        'de',
      ),
    ).toBe('de');
  });
});
