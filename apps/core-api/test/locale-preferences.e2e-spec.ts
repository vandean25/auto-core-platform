import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { createTestTenant } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Locale preferences (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenantId: string;
  let token: string;
  let userDbId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    const fixture = await createTestTenant(prisma, 'aut576');
    tenantId = fixture.tenantId;
    token = authService.createTestToken({
      sub: fixture.firebaseUid,
      email: fixture.email,
      tenantId: fixture.tenantId,
      role: fixture.role,
    });
    const user = await prisma.user.findFirst({
      where: { firebaseUid: fixture.firebaseUid },
      select: { id: true },
    });
    userDbId = user!.id;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

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
});
