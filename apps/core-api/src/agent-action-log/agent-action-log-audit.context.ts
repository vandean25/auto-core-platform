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

  // request_id is a string column, but agent_action_logs.trace_id is a UUID
  // column that Postgres returns in lowercase. Store the lowercase form so the
  // audit rows and the action log join on the same value.
  TenantContextStorage.setRequestMeta({
    ...existing,
    auditCorrelationId: traceId.toLowerCase(),
  });

  try {
    return await callback();
  } finally {
    TenantContextStorage.setRequestMeta(existing);
  }
}
