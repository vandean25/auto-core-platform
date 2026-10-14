import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildTaskRequest,
  type BuildTaskRequestParams,
} from './cloud-tasks.request.js';

const NOW_MS = 1_700_000_000_500;

const params: BuildTaskRequestParams = {
  url: 'https://worker.example.test/api/invoices/inv-1/pdf/worker',
  workerSecret: 'worker-secret',
  tenantId: 'tenant-1',
  payload: { kind: 'invoice', resourceId: 'inv-1', tenantId: 'tenant-1' },
  invokerServiceAccount: 'invoker@example.test',
  targetBaseUrl: 'https://worker.example.test/api/',
};

describe('buildTaskRequest', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('omits the schedule time when there is no positive delay', () => {
    expect(buildTaskRequest(params).scheduleTime).toBeUndefined();
    expect(
      buildTaskRequest({ ...params, delaySeconds: 0 }).scheduleTime,
    ).toBeUndefined();
    expect(
      buildTaskRequest({ ...params, delaySeconds: -5 }).scheduleTime,
    ).toBeUndefined();
  });

  it('schedules the task the whole number of delay seconds ahead', () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    expect(
      buildTaskRequest({ ...params, delaySeconds: 20.9 }).scheduleTime,
    ).toEqual({ seconds: 1_700_000_020 });
  });

  it('defaults the dispatch deadline to 600 seconds and honours an override', () => {
    expect(buildTaskRequest(params).dispatchDeadline).toEqual({ seconds: 600 });
    expect(
      buildTaskRequest({ ...params, dispatchDeadlineSeconds: 60 })
        .dispatchDeadline,
    ).toEqual({ seconds: 60 });
  });

  it('sends the worker secret, tenant and OIDC settings with the request', () => {
    const task = buildTaskRequest(params);

    expect(task.httpRequest).toMatchObject({
      httpMethod: 'POST',
      url: params.url,
      headers: {
        'Content-Type': 'application/json',
        'x-cloud-tasks-secret': 'worker-secret',
        'x-tenant-id': 'tenant-1',
      },
      oidcToken: {
        serviceAccountEmail: 'invoker@example.test',
        audience: 'https://worker.example.test',
      },
    });
    expect(JSON.parse(task.httpRequest.body.toString())).toEqual(
      params.payload,
    );
  });
});
