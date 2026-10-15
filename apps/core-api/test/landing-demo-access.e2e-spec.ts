import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootstrapE2eApp } from './helpers/e2e-suite.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Landing demo access (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.LANDING_DEMO_ACCESS_ENABLED = 'true';
    process.env.LANDING_DEMO_SIGN_IN_CONTINUE_URL = 'https://app.example/login';
    process.env.LANDING_PAGE_ORIGINS = 'https://landing-demo.web.app';
    ({ app } = await bootstrapE2eApp());
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  it('returns ok for honeypot submissions without enabling side effects', async () => {
    const { SystemPrismaService } = await import(
      '../src/prisma/system-prisma.service.js'
    );
    const prisma = app.get(SystemPrismaService);
    const before = await prisma.landingDemoAccessRequest.count();

    const response = await request(app.getHttpServer())
      .post('/api/public/landing-demo/access')
      .set('Origin', 'https://landing-demo.web.app')
      .send({
        name: 'Bot',
        betrieb: 'Spam',
        email: 'bot@example.com',
        consent: true,
        website: 'filled',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    const after = await prisma.landingDemoAccessRequest.count();
    expect(after).toBe(before);
  });

  it('rejects missing consent with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/public/landing-demo/access')
      .send({
        name: 'Maria',
        betrieb: 'Werkstatt',
        email: 'maria@example.com',
        consent: false,
      });

    expect(response.status).toBe(400);
  });
});
