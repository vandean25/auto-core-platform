import { Logger } from '@nestjs/common';
import { DecisionAuditRecorder } from './decision-audit-recorder.service.js';
import type { LiveDecision } from './decision-live-apply.types.js';

const TRACE_ID = '2f1c2b5e-6a1f-4f5e-9d3a-0c1b2a3d4e5f';

function decision(): LiveDecision {
  return {
    tenantId: 'tenant-1',
    useCase: 'import_row_matching',
    actionType: 'decision.import_row_match',
    tier: 'AUTO',
    policyReasons: [],
    traceId: TRACE_ID,
    outcome: 'fallback',
    reason: 'timeout',
    entityType: 'ImportJob',
    entityId: 'job-1',
    redactedInput: {},
    redactedChoices: ['choice_1'],
    redactedRulesChoice: 'choice_1',
    redactedSuggestedChoice: null,
    providerCall: { ok: false, reason: 'timeout', suggestion: null },
    providerId: 'openrouter-jev',
    targetEntityId: null,
    rowNo: 1,
  };
}

function buildRecorder(options: { shadowEnabled: boolean }) {
  const actionLog = {
    record: jest.fn().mockResolvedValue({ id: 'log-1' }),
  };
  const shadow = {
    isShadowEnabled: jest.fn().mockReturnValue(options.shadowEnabled),
    writeShadowRecord: jest.fn().mockResolvedValue(undefined),
  };
  const recorder = new DecisionAuditRecorder(
    actionLog as never,
    shadow as never,
  );
  return { recorder, actionLog, shadow };
}

describe('DecisionAuditRecorder', () => {
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes one audit row and no shadow row when shadow logging is off', async () => {
    const { recorder, actionLog, shadow } = buildRecorder({
      shadowEnabled: false,
    });

    await recorder.record(decision());

    expect(actionLog.record).toHaveBeenCalledTimes(1);
    expect(actionLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: TRACE_ID, status: 'FALLBACK' }),
    );
    expect(shadow.writeShadowRecord).not.toHaveBeenCalled();
  });

  it('writes the audit row and the shadow row when shadow logging is on', async () => {
    const { recorder, shadow } = buildRecorder({ shadowEnabled: true });

    await recorder.record(decision());

    expect(shadow.writeShadowRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        useCase: 'import_row_matching',
      }),
      { suggestion: null, error: 'timeout', providerId: 'openrouter-jev' },
    );
  });

  it('logs a failed audit write without a message, and still writes the shadow row', async () => {
    const { recorder, actionLog, shadow } = buildRecorder({
      shadowEnabled: true,
    });
    actionLog.record.mockRejectedValueOnce(new Error('db down'));

    await expect(recorder.record(decision())).resolves.toBeUndefined();

    expect(shadow.writeShadowRecord).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Decision live audit write failed for import_row_matching: Error',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('db down');
  });

  it('swallows a failed shadow write', async () => {
    const { recorder, shadow } = buildRecorder({ shadowEnabled: true });
    shadow.writeShadowRecord.mockRejectedValueOnce(new Error('shadow down'));

    await expect(recorder.record(decision())).resolves.toBeUndefined();

    expect(debug).toHaveBeenCalledWith(
      'Decision live shadow write failed for import_row_matching: Error',
    );
  });
});
