import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { teardownTestApp } from './test-lifecycle.js';

describe('Internal HTTP cron (e2e)', () => {
  let app: INestApplication;
  let basePrisma: import('../src/prisma/prisma.service.js').PrismaService;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [
      'SCHEDULER_MODE',
      'CRON_OIDC_AUDIENCE',
      'CRON_INVOKER_SA_EMAIL',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.SCHEDULER_MODE = 'http';
    process.env.CRON_OIDC_AUDIENCE = 'https://core-api-PLACEHOLDER.run.app';
    process.env.CRON_INVOKER_SA_EMAIL =
      'scheduler-invoker@PLACEHOLDER.iam.gserviceaccount.com';
    if (!process.env.DATABASE_URL?.trim()) {
      process.env.DATABASE_URL =
        'postgresql://postgres:postgres@127.0.0.1:5432/core_api_e2e';
    }

    const { CronInvokerOidcGuard } =
      await import('../src/common/guards/cron-invoker-oidc.guard.js');
    const { CoreApiCronJobRegistryService } =
      await import('../src/scheduler/core-api-cron-job-registry.service.js');
    const { createE2eApp } = await import('./helpers/e2e-suite.js');
    const { PrismaService } = await import('../src/prisma/prisma.service.js');

    app = await createE2eApp((builder) =>
      builder
        .overrideGuard(CronInvokerOidcGuard)
        .useValue({
          canActivate: () => true,
        })
        .overrideProvider(CoreApiCronJobRegistryService)
        .useValue({
          isKnownJobName: (name: string) =>
            name === 'landing-demo-access-cleanup',
          run: async () => true,
        }),
    );
    basePrisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (app) {
      await teardownTestApp(app, basePrisma as never);
    }
  });

  it('invokes a documented cron job over HTTP', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/internal/cron/landing-demo-access-cleanup')
      .set('Authorization', 'Bearer e2e-placeholder-token')
      .expect(200);

    expect(response.body.status === 'ran' || response.body.status === 'skipped')
      .toBe(true);
  });
});
