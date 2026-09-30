import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DocumentBrandingExtractionTaskGuard } from './document-branding-extraction-task.guard.js';
import { signDocumentBrandingExtractionTask } from './document-branding-extraction-task.js';

describe('DocumentBrandingExtractionTaskGuard', () => {
  const previousSecret = process.env.CLOUD_TASKS_WORKER_SECRET;
  const secret = 'worker-secret';
  const claims = {
    extractionId: 'extraction-1',
    legalEntityId: 'entity-1',
    tenantId: 'tenant-1',
    expectedAttemptCount: 0,
  };
  const setTenantIdForWorker = jest.fn();
  let guard: DocumentBrandingExtractionTaskGuard;

  beforeEach(() => {
    process.env.CLOUD_TASKS_WORKER_SECRET = secret;
    setTenantIdForWorker.mockClear();
    guard = new DocumentBrandingExtractionTaskGuard({
      setTenantIdForWorker,
    } as unknown as TenantContextService);
  });

  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.CLOUD_TASKS_WORKER_SECRET;
    } else {
      process.env.CLOUD_TASKS_WORKER_SECRET = previousSecret;
    }
  });

  it('binds the signed task body to route IDs and tenant header', () => {
    const request = {
      body: signDocumentBrandingExtractionTask(claims, secret),
      params: { extractionId: 'extraction-1', legalEntityId: 'entity-1' },
      headers: { 'x-tenant-id': 'tenant-1' },
    };

    expect(guard.canActivate(executionContext(request))).toBe(true);
    expect(setTenantIdForWorker).toHaveBeenCalledWith('tenant-1');
  });

  it('rejects a signed entity that does not match the route', () => {
    const request = {
      body: signDocumentBrandingExtractionTask(claims, secret),
      params: { extractionId: 'extraction-1', legalEntityId: 'entity-other' },
      headers: { 'x-tenant-id': 'tenant-1' },
    };

    expect(() => guard.canActivate(executionContext(request))).toThrow(
      ForbiddenException,
    );
    expect(setTenantIdForWorker).not.toHaveBeenCalled();
  });

  it('rejects a tenant header that does not match the signed task', () => {
    const request = {
      body: signDocumentBrandingExtractionTask(claims, secret),
      params: { extractionId: 'extraction-1', legalEntityId: 'entity-1' },
      headers: { 'x-tenant-id': 'tenant-other' },
    };

    expect(() => guard.canActivate(executionContext(request))).toThrow(
      ForbiddenException,
    );
    expect(setTenantIdForWorker).not.toHaveBeenCalled();
  });
});

function executionContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
