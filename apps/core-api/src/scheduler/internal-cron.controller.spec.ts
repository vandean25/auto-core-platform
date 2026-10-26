import { jest } from '@jest/globals';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CronInvokerOidcGuard } from '../common/guards/cron-invoker-oidc.guard.js';
import { CoreApiCronJobRegistryService } from './core-api-cron-job-registry.service.js';
import { InternalCronController } from './internal-cron.controller.js';
import { HttpCronModeGuard } from './http-cron-mode.guard.js';

describe('InternalCronController', () => {
  let app: INestApplication;
  const run = jest.fn<CoreApiCronJobRegistryService['run']>();
  const isKnownJobName = jest.fn<CoreApiCronJobRegistryService['isKnownJobName']>();
  const savedSchedulerMode = process.env.SCHEDULER_MODE;

  beforeAll(async () => {
    process.env.SCHEDULER_MODE = 'http';
    process.env.CRON_OIDC_AUDIENCE = 'https://core-api-PLACEHOLDER.run.app';
    process.env.CRON_INVOKER_SA_EMAIL =
      'scheduler-invoker@PLACEHOLDER.iam.gserviceaccount.com';

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalCronController],
      providers: [
        HttpCronModeGuard,
        {
          provide: CoreApiCronJobRegistryService,
          useValue: { run, isKnownJobName },
        },
      ],
    })
      .overrideGuard(CronInvokerOidcGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (savedSchedulerMode === undefined) {
      delete process.env.SCHEDULER_MODE;
    } else {
      process.env.SCHEDULER_MODE = savedSchedulerMode;
    }
    await app.close();
  });

  beforeEach(() => {
    run.mockReset();
    isKnownJobName.mockReset();
  });

  it('returns 404 when scheduler mode is not http', async () => {
    process.env.SCHEDULER_MODE = 'in-process';
    await request(app.getHttpServer())
      .post('/api/internal/cron/landing-demo-access-cleanup')
      .expect(404);
    process.env.SCHEDULER_MODE = 'http';
  });

  it('returns 404 for unknown job names', async () => {
    isKnownJobName.mockReturnValue(false);
    await request(app.getHttpServer())
      .post('/api/internal/cron/unknown-job')
      .expect(404);
  });

  it('returns ran when the lock allows work', async () => {
    isKnownJobName.mockReturnValue(true);
    run.mockResolvedValue(true);
    const response = await request(app.getHttpServer())
      .post('/api/internal/cron/landing-demo-access-cleanup')
      .expect(200);
    expect(response.body).toEqual({ status: 'ran' });
  });

  it('returns skipped when the advisory lock is held elsewhere', async () => {
    isKnownJobName.mockReturnValue(true);
    run.mockResolvedValue(false);
    const response = await request(app.getHttpServer())
      .post('/api/internal/cron/landing-demo-access-cleanup')
      .expect(200);
    expect(response.body).toEqual({ status: 'skipped' });
  });

  it('returns 500 when the job throws', async () => {
    isKnownJobName.mockReturnValue(true);
    run.mockRejectedValue(new Error('boom'));
    await request(app.getHttpServer())
      .post('/api/internal/cron/landing-demo-access-cleanup')
      .expect(500);
  });
});

describe('InternalCronController auth', () => {
  it('returns 401 when OIDC guard rejects the request', async () => {
    process.env.SCHEDULER_MODE = 'http';
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalCronController],
      providers: [
        HttpCronModeGuard,
        {
          provide: CoreApiCronJobRegistryService,
          useValue: {
            run: jest.fn(),
            isKnownJobName: () => true,
          },
        },
      ],
    })
      .overrideGuard(CronInvokerOidcGuard)
      .useValue({
        canActivate: () => {
          throw new UnauthorizedException();
        },
      })
      .compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    await request(app.getHttpServer())
      .post('/api/internal/cron/landing-demo-access-cleanup')
      .expect(401);
    await app.close();
  });
});
