import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  TenantContextStorage,
  type AuditSource,
  type RequestMeta,
} from './tenant-context.storage';

export type { AuditSource, RequestMeta };

export type WorkerContextOptions = {
  /** Override the generated worker ID (defaults to `'cloud-tasks-worker'`). */
  workerId?: string;
  /** Email address associated with the worker actor (defaults to empty string). */
  email?: string;
  /**
   * Audit source to stamp on the context (defaults to `'JOB'`).
   * Pass `'SCRIPT'` for one-off migration / maintenance scripts.
   */
  source?: AuditSource;
};

/**
 * Provides read access to the current ALS request context (request ID, source,
 * IP, user-agent) and a helper to bootstrap a full context for non-HTTP work.
 *
 * This service reads directly from {@link TenantContextStorage} so it is safe
 * to call synchronously from Prisma extensions and other non-async contexts.
 */
@Injectable()
export class RequestContextService {
  /** Returns the correlation / request ID for the active ALS context. */
  getRequestId(): string | undefined {
    return TenantContextStorage.getRequestMeta()?.requestId;
  }

  /** Returns the audit source (`API`, `JOB`, or `SCRIPT`) for the active context. */
  getSource(): AuditSource | undefined {
    return TenantContextStorage.getRequestMeta()?.source;
  }

  /** Returns the client IP address captured by the middleware (HTTP only). */
  getIp(): string | undefined {
    return TenantContextStorage.getRequestMeta()?.ip;
  }

  /** Returns the User-Agent string captured by the middleware (HTTP only). */
  getUserAgent(): string | undefined {
    return TenantContextStorage.getRequestMeta()?.userAgent;
  }

  /**
   * Runs `callback` inside a fresh ALS context pre-populated with worker/job
   * identity. Use this at the entry point of scheduled jobs, cron callbacks,
   * and any non-HTTP code that must write auditable records.
   *
   * @example
   * ```typescript
   * await this.requestContext.runAsWorker(tenantId, async () => {
   *   await this.inventoryService.reconcileStock();
   * });
   * ```
   */
  runAsWorker<T>(
    tenantId: string,
    callback: () => T,
    options?: WorkerContextOptions,
  ): T {
    return TenantContextStorage.run(() => {
      const workerId = options?.workerId ?? 'cloud-tasks-worker';
      const email = options?.email ?? '';
      const source = options?.source ?? 'JOB';

      TenantContextStorage.setUser({
        userId: workerId,
        email,
        tenantId,
        role: 'worker',
      });

      TenantContextStorage.setRequestMeta({
        requestId: randomUUID(),
        source,
      });

      return callback();
    });
  }
}
