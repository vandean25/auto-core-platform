import { TenantContextStorage } from '../common/services/tenant-context.storage.js';

export async function runWithAgentAuditTrace<T>(
  traceId: string,
  callback: () => Promise<T> | T,
): Promise<T> {
  const existing = TenantContextStorage.getRequestMeta();
  if (!existing) {
    throw new Error(
      'Agent audit trace requires an active request context (AsyncLocalStorage).',
    );
  }

  TenantContextStorage.setRequestMeta({
    ...existing,
    auditCorrelationId: traceId,
  });

  try {
    return await callback();
  } finally {
    TenantContextStorage.setRequestMeta(existing);
  }
}
