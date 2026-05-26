import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

/** The originating context for an auditable operation. */
export type AuditSource = 'API' | 'JOB' | 'SCRIPT';

/** Request-level metadata stored alongside the authenticated user. */
export type RequestMeta = {
  /** Correlation ID – propagated from inbound `x-request-id` or server-generated. */
  requestId: string;
  /** How this operation was triggered. */
  source: AuditSource;
  /** Client IP address (undefined for non-HTTP contexts). */
  ip?: string;
  /** User-Agent string (undefined for non-HTTP contexts). */
  userAgent?: string;
};

type TenantRequestContext = {
  user?: AuthenticatedUser;
  requestMeta?: RequestMeta;
};

const tenantContextStorage = new AsyncLocalStorage<TenantRequestContext>();

export class TenantContextStorage {
  static run<T>(callback: () => T): T {
    return tenantContextStorage.run({}, callback);
  }

  static setUser(user: AuthenticatedUser) {
    const store = tenantContextStorage.getStore();
    if (store) {
      store.user = user;
    }
  }

  static getUser(): AuthenticatedUser | undefined {
    return tenantContextStorage.getStore()?.user;
  }

  static setRequestMeta(meta: RequestMeta): void {
    const store = tenantContextStorage.getStore();
    if (store) {
      store.requestMeta = meta;
    }
  }

  static getRequestMeta(): RequestMeta | undefined {
    return tenantContextStorage.getStore()?.requestMeta;
  }
}
