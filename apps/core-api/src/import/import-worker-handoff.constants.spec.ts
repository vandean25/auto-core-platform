import {
  IMPORT_WORKER_DISPATCH_DEADLINE_SECONDS,
  IMPORT_WORKER_HANDOFF_GRACE_MS,
} from './import-worker-handoff.constants.js';
import { importWorkerRetryDelaySeconds } from './import-worker-retry.js';

describe('import worker handoff timing', () => {
  it('keeps handoff grace longer than dispatch deadline plus first retry backoff', () => {
    const dispatchMs = IMPORT_WORKER_DISPATCH_DEADLINE_SECONDS * 1000;
    const firstRetryMs = importWorkerRetryDelaySeconds(0) * 1000;
    expect(IMPORT_WORKER_HANDOFF_GRACE_MS).toBeGreaterThan(
      dispatchMs + firstRetryMs,
    );
  });
});
