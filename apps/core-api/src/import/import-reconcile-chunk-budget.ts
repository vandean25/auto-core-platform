import { IMPORT_RECONCILE_UNIT_TX } from './import.constants.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';

/** Same absolute deadline as background dry-run row batches (`import.service`). */
export function importWorkerChunkDeadlineMs(fromMs: number): number {
  return fromMs + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
}

export function importWorkerChunkBudgetElapsed(
  nowMs: number,
  chunkDeadlineMs: number,
): boolean {
  return nowMs >= chunkDeadlineMs;
}

/** Reserve before starting another reconcile unit (matches unit transaction timeout ceiling). */
export function importWorkerReconcileUnitBudgetReserveMs(): number {
  return IMPORT_RECONCILE_UNIT_TX.timeout;
}

export function importWorkerChunkBudgetAllowsAnotherUnit(
  nowMs: number,
  chunkDeadlineMs: number,
  unitReserveMs = importWorkerReconcileUnitBudgetReserveMs(),
): boolean {
  return chunkDeadlineMs - nowMs >= unitReserveMs;
}
