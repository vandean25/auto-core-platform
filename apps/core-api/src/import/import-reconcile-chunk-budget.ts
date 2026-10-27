import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';

export function reconcileChunkDeadlineMs(chunkStartedMs: number): number {
  return chunkStartedMs + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
}

/** True when the chunk budget is exhausted and the next unit must not start. */
export function reconcileChunkShouldStopBeforeNextUnit(
  nowMs: number,
  chunkStartedMs: number,
): boolean {
  return nowMs >= reconcileChunkDeadlineMs(chunkStartedMs);
}
