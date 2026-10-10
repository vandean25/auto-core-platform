import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { runWithAgentAuditTrace } from './agent-action-log-audit.context.js';

describe('runWithAgentAuditTrace', () => {
  const traceId = '6F1C2B7E-3D4A-4B8E-9C2D-1A2B3C4D5E6F';

  it('correlates audit rows with the trace in lowercase while the request keeps the trace as sent', async () => {
    await TenantContextStorage.run(async () => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-1',
        traceId,
        source: 'API',
      });

      await runWithAgentAuditTrace(traceId, () => {
        expect(TenantContextStorage.getRequestMeta()).toMatchObject({
          traceId,
          auditCorrelationId: traceId.toLowerCase(),
        });
      });

      expect(
        TenantContextStorage.getRequestMeta()?.auditCorrelationId,
      ).toBeUndefined();
    });
  });
});
