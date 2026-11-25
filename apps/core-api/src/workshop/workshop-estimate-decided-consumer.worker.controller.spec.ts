import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER } from '../domain-event-consumer/domain-event-consumer.constants.js';
import { signDomainEventConsumerTaskPayload } from '../domain-event-consumer/domain-event-consumer-task.payload.js';
import { DomainEventConsumerTaskGuard } from '../domain-event-consumer/domain-event-consumer-task.guard.js';
import { WorkshopEstimateDecidedConsumerService } from './workshop-estimate-decided-consumer.service.js';
import { WorkshopEstimateDecidedConsumerWorkerController } from './workshop-estimate-decided-consumer.worker.controller.js';

const WORKER_SECRET = 'consumer-worker-test-secret';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CLAIMS = {
  tenantId: TENANT_ID,
  consumerKey: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
};
const WORKER_PATH = `/domain-event-consumers/${encodeURIComponent(CLAIMS.consumerKey)}/worker`;
const VALID_TASK = signDomainEventConsumerTaskPayload(CLAIMS, WORKER_SECRET);

describe('WorkshopEstimateDecidedConsumerWorkerController', () => {
  let app: INestApplication;
  const processTenantBatch =
    jest.fn<WorkshopEstimateDecidedConsumerService['processTenantBatch']>();
  const originalWorkerSecret = process.env.CLOUD_TASKS_WORKER_SECRET;

  beforeAll(async () => {
    process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkshopEstimateDecidedConsumerWorkerController],
      providers: [
        CloudTasksWorkerGuard,
        DomainEventConsumerTaskGuard,
        {
          provide: TenantContextService,
          useValue: { setTenantIdForWorker: jest.fn() },
        },
        {
          provide: WorkshopEstimateDecidedConsumerService,
          useValue: { processTenantBatch },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (originalWorkerSecret === undefined) {
      delete process.env.CLOUD_TASKS_WORKER_SECRET;
    } else {
      process.env.CLOUD_TASKS_WORKER_SECRET = originalWorkerSecret;
    }
    await app.close();
  });

  beforeEach(() => {
    processTenantBatch.mockReset();
    processTenantBatch.mockResolvedValue(0);
  });

  function postTask(payload: object | undefined) {
    return request(app.getHttpServer())
      .post(WORKER_PATH)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', TENANT_ID)
      .send(payload);
  }

  it('returns 403 for an invalid signature so Cloud Tasks stops retrying', async () => {
    await postTask({ ...VALID_TASK, signature: '0'.repeat(64) }).expect(403);
  });

  it('returns 403 for an empty body instead of retrying it', async () => {
    await postTask(undefined).expect(403);
  });

  it('checks the worker secret before rejecting a missing signature', async () => {
    await request(app.getHttpServer())
      .post(WORKER_PATH)
      .set('x-cloud-tasks-secret', 'invalid-worker-secret')
      .set('x-tenant-id', TENANT_ID)
      .send(CLAIMS)
      .expect(401);
  });

  it.each([
    { label: 'missing', task: { ...CLAIMS } },
    {
      label: 'non-hex',
      task: { ...VALID_TASK, signature: `${VALID_TASK.signature}z` },
    },
    {
      label: 'wrong-length',
      task: { ...VALID_TASK, signature: VALID_TASK.signature.slice(1) },
    },
  ])('returns 403 for a $label signature', async ({ task }) => {
    await postTask(task).expect(403);
  });

  it('returns 204 for a valid signed task', async () => {
    await postTask(VALID_TASK).expect(204);

    expect(processTenantBatch).toHaveBeenCalledWith(TENANT_ID, expect.any(Date));
  });

  it('returns 500 when processing fails so Cloud Tasks still retries', async () => {
    processTenantBatch.mockRejectedValue(new Error('Processing failed'));

    await postTask(VALID_TASK).expect(500);
  });

  it('returns 403 when the signed consumer does not match the route', async () => {
    await request(app.getHttpServer())
      .post('/domain-event-consumers/another-consumer/worker')
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', TENANT_ID)
      .send(VALID_TASK)
      .expect(403);
  });

  it('returns 403 when the tenant header does not match the signed tenant', async () => {
    await request(app.getHttpServer())
      .post(WORKER_PATH)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', OTHER_TENANT_ID)
      .send(VALID_TASK)
      .expect(403);
  });
});
