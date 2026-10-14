import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import {
  PUBLIC_ESTIMATE_APPROVAL_ROLE,
  TenantContextStorage,
} from './tenant-context.storage.js';

@Injectable()
export class TenantContextService {
  setAuthenticatedUser(user: AuthenticatedUser) {
    TenantContextStorage.setUser(user);
  }

  /**
   * The public estimate approval route (ADR-0025 §7) has no session. Once the token lookup names its tenant,
   * the request runs as that tenant under a service identity, so every later query is tenant-scoped.
   */
  setPublicEstimateApprovalTenant(tenantId: string): void {
    this.setAuthenticatedUser({
      userId: 'public-estimate-approval',
      email: '',
      tenantId,
      role: PUBLIC_ESTIMATE_APPROVAL_ROLE,
    });
  }

  setTenantIdForWorker(tenantId: string): void {
    this.setAuthenticatedUser({
      userId: 'cloud-tasks-worker',
      email: '',
      tenantId,
      role: 'worker',
    });
    // Override the source to JOB; preserve the requestId that TenantContextMiddleware
    // already generated for this HTTP context (Cloud Tasks delivers via HTTP).
    const existing = TenantContextStorage.getRequestMeta();
    TenantContextStorage.setRequestMeta({
      requestId: existing?.requestId ?? randomUUID(),
      traceId: existing?.traceId ?? randomUUID(),
      source: 'JOB',
      ip: existing?.ip,
      userAgent: existing?.userAgent,
      auditCorrelationId: existing?.auditCorrelationId,
    });
  }

  getAuthenticatedUser(): AuthenticatedUser | undefined {
    return TenantContextStorage.getUser();
  }

  /**
   * Returns the current tenant ID synchronously from the AsyncLocalStorage context.
   * Throws InternalServerErrorException if no tenant context has been set for this request.
   * Use this in Prisma extensions and other synchronous-context code paths.
   */
  getRequiredTenantId(): string {
    const user = TenantContextStorage.getUser();
    if (!user?.tenantId) {
      throw new InternalServerErrorException(
        'Tenant context not initialised. Is the JwtAuthGuard applied?',
      );
    }
    return user.tenantId;
  }

  /**
   * Returns the current tenant ID from ALS. Fails closed when no user/tenantId is set —
   * there is no default-workshop or DEFAULT_TENANT_ID fallback.
   * Cloud Tasks workers must call setTenantIdForWorker(tenantId) first.
   */
  async getTenantId(): Promise<string> {
    return await Promise.resolve(this.getRequiredTenantId());
  }
}
