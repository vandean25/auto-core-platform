import {
  importWorkerChunkBudgetAllowsAnotherUnit,
  importWorkerChunkBudgetElapsed,
  importWorkerChunkDeadlineMs,
  importWorkerReconcileUnitBudgetReserveMs,
} from './import-reconcile-chunk-budget.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';

describe('importWorkerChunkDeadlineMs', () => {
  it('matches the background dry-run chunk budget', () => {
    const started = 5_000;
    const deadline = importWorkerChunkDeadlineMs(started);
    expect(deadline).toBe(started + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS);
    expect(importWorkerChunkBudgetElapsed(deadline, deadline)).toBe(true);
    expect(importWorkerChunkBudgetElapsed(deadline - 1, deadline)).toBe(false);
  });
});

describe('importWorkerChunkBudgetAllowsAnotherUnit', () => {
  it('requires the reconcile unit transaction reserve before another unit', () => {
    const reserve = importWorkerReconcileUnitBudgetReserveMs();
    const deadline = 100_000;
    expect(importWorkerChunkBudgetAllowsAnotherUnit(deadline - reserve, deadline)).toBe(
      true,
    );
    expect(
      importWorkerChunkBudgetAllowsAnotherUnit(deadline - reserve + 1, deadline),
    ).toBe(false);
  });
});
