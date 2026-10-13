import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { signNotificationTaskPayload } from './notification-task.payload.js';
import { NotificationTaskGuard } from './notification-task.guard.js';

const SECRET = 'worker-secret-test';

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

describe('NotificationTaskGuard', () => {
  const tenantContext = { setTenantIdForWorker: jest.fn() };
  const guard = new NotificationTaskGuard(tenantContext as never);
  const signed = signNotificationTaskPayload(
    { outboxId: 'outbox-1', tenantId: 'tenant-1' },
    SECRET,
  );
  // Cloud Tasks always sends the tenant header next to the signed body (buildTaskRequest).
  const taskHeaders = { 'x-tenant-id': 'tenant-1' };

  beforeEach(() => {
    process.env.CLOUD_TASKS_WORKER_SECRET = SECRET;
    tenantContext.setTenantIdForWorker.mockReset();
  });

  afterAll(() => {
    delete process.env.CLOUD_TASKS_WORKER_SECRET;
  });

  it('binds the tenant from the signed payload when the route matches', () => {
    const allowed = guard.canActivate(
      contextFor({
        body: signed,
        params: { outboxId: 'outbox-1' },
        headers: taskHeaders,
      }),
    );

    expect(allowed).toBe(true);
    expect(tenantContext.setTenantIdForWorker).toHaveBeenCalledWith('tenant-1');
  });

  it('refuses a payload addressed to a different outbox row', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          body: signed,
          params: { outboxId: 'outbox-2' },
          headers: taskHeaders,
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });

  it('refuses a tenant header that disagrees with the signed payload', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          body: signed,
          params: { outboxId: 'outbox-1' },
          headers: { 'x-tenant-id': 'tenant-2' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('refuses a call that carries no tenant header, because Cloud Tasks always sends one', () => {
    expect(() =>
      guard.canActivate(
        contextFor({ body: signed, params: { outboxId: 'outbox-1' } }),
      ),
    ).toThrow(ForbiddenException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });
});
