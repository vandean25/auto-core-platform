import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PdfTaskTenantGuard } from './pdf-task-tenant.guard';
import { PDF_TASK_KIND_KEY, signPdfTaskPayload } from './pdf-task-payload';
import { TenantContextService } from '../services/tenant-context.service';

describe('PdfTaskTenantGuard', () => {
  const secret = 'valid-secret';
  const claims = {
    kind: 'workshop-order' as const,
    resourceId: '11111111-1111-1111-1111-111111111111',
    tenantId: 'tenant-abc',
  };

  let guard: PdfTaskTenantGuard;
  let tenantContext: { setTenantIdForWorker: jest.Mock };

  beforeEach(() => {
    process.env.CLOUD_TASKS_WORKER_SECRET = secret;
    tenantContext = { setTenantIdForWorker: jest.fn() };
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === PDF_TASK_KIND_KEY) return claims.kind;
      return undefined;
    });
    guard = new PdfTaskTenantGuard(
      reflector,
      tenantContext as unknown as TenantContextService,
    );
  });

  afterEach(() => {
    delete process.env.CLOUD_TASKS_WORKER_SECRET;
    jest.restoreAllMocks();
  });

  function createContext(params: {
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
    id?: string;
  }): ExecutionContext {
    const mockRequest = {
      body: params.body,
      headers: params.headers ?? {},
      params: { id: params.id ?? claims.resourceId },
    };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => mockRequest }),
    } as unknown as ExecutionContext;
  }

  it('binds tenant from the signed payload when the header matches', () => {
    const body = signPdfTaskPayload(claims, secret);
    const context = createContext({
      body,
      headers: { 'x-tenant-id': claims.tenantId },
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(tenantContext.setTenantIdForWorker).toHaveBeenCalledWith(
      claims.tenantId,
    );
  });

  it('rejects when x-tenant-id differs from the signed payload tenant', () => {
    const body = signPdfTaskPayload(claims, secret);
    const context = createContext({
      body,
      headers: { 'x-tenant-id': 'tenant-other' },
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });

  it('binds tenant from the signed payload when the header is omitted', () => {
    const body = signPdfTaskPayload(claims, secret);
    const context = createContext({ body, headers: {} });

    expect(guard.canActivate(context)).toBe(true);
    expect(tenantContext.setTenantIdForWorker).toHaveBeenCalledWith(
      claims.tenantId,
    );
  });

  it('rejects a payload whose kind does not match the worker metadata', () => {
    const body = signPdfTaskPayload({ ...claims, kind: 'invoice' }, secret);
    const context = createContext({
      body,
      headers: { 'x-tenant-id': claims.tenantId },
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });

  it('rejects a payload whose resourceId does not match the route id', () => {
    const body = signPdfTaskPayload(claims, secret);
    const context = createContext({
      body,
      headers: { 'x-tenant-id': claims.tenantId },
      id: '22222222-2222-2222-2222-222222222222',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });

  it('rejects an unsigned body', () => {
    const context = createContext({
      body: { tenantId: claims.tenantId },
      headers: { 'x-tenant-id': claims.tenantId },
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(tenantContext.setTenantIdForWorker).not.toHaveBeenCalled();
  });
});
