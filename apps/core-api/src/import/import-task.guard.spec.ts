import {
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { signImportTaskPayload } from './import-task.payload.js';
import { ImportTaskGuard } from './import-task.guard.js';

const SECRET = 'import-worker-secret-test';

function contextFor(options: {
  body: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}): ExecutionContext {
  const request = {
    body: options.body,
    params: options.params ?? {},
    headers: options.headers ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ImportTaskGuard', () => {
  const tenantContext = { setTenantIdForWorker: jest.fn() };
  const guard = new ImportTaskGuard(tenantContext as never);
  const signed = signImportTaskPayload(
    { tenantId: 'tenant-a', jobId: 'job-1', phase: 'dry_run' },
    SECRET,
  );

  beforeEach(() => {
    process.env.CLOUD_TASKS_WORKER_SECRET = SECRET;
    tenantContext.setTenantIdForWorker.mockReset();
  });

  afterAll(() => {
    delete process.env.CLOUD_TASKS_WORKER_SECRET;
  });

  it('binds the tenant from the signed payload when the signature is valid', () => {
    const allowed = guard.canActivate(
      contextFor({
        body: signed,
        params: { id: 'job-1' },
        headers: { 'x-tenant-id': 'tenant-other' },
      }),
    );

    expect(allowed).toBe(true);
    expect(tenantContext.setTenantIdForWorker).toHaveBeenCalledWith('tenant-a');
  });

  it('rejects an invalid signature and does not bind tenant context', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          body: { ...signed, signature: 'not-valid' },
          params: { id: 'job-1' },
        }),
      ),
    ).toThrow(UnauthorizedException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });

  it('ignores a tenant id in the route params', () => {
    guard.canActivate(
      contextFor({
        body: signed,
        params: { id: 'job-1', tenantId: 'tenant-route' },
      }),
    );

    expect(tenantContext.setTenantIdForWorker).toHaveBeenCalledWith('tenant-a');
  });

  it('throws when the worker secret is not configured', () => {
    delete process.env.CLOUD_TASKS_WORKER_SECRET;

    expect(() =>
      guard.canActivate(contextFor({ body: signed, params: { id: 'job-1' } })),
    ).toThrow(InternalServerErrorException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });
});
