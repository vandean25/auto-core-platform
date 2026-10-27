import {
  reconcileChunkDeadlineMs,
  reconcileChunkShouldStopBeforeNextUnit,
} from './import-reconcile-chunk-budget.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';

describe('reconcileChunkShouldStopBeforeNextUnit', () => {
  it('does not stop at chunk start', () => {
    const started = 1_000;
    expect(reconcileChunkShouldStopBeforeNextUnit(started, started)).toBe(
      false,
    );
  });

  it('stops once the chunk budget elapses', () => {
    const started = 5_000;
    const deadline = reconcileChunkDeadlineMs(started);
    expect(deadline).toBe(started + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS);
    expect(reconcileChunkShouldStopBeforeNextUnit(deadline, started)).toBe(
      true,
    );
    expect(
      reconcileChunkShouldStopBeforeNextUnit(deadline - 1, started),
    ).toBe(false);
  });
});
