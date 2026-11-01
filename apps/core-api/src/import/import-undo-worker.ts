import { randomUUID } from 'node:crypto';
import type { ImportJobOptions } from './import.types.js';

/** One committed undo transaction may take this long before Prisma aborts it. */
export const IMPORT_UNDO_BATCH_TX = { timeout: 30_000, maxWait: 10_000 };

/** Lease lifetime; the worker renews it with every committed batch. */
export const IMPORT_UNDO_LEASE_MS = 120_000;

/** An UNDOING job whose heartbeat is older than this may be reclaimed even with a live lease. */
export const IMPORT_UNDO_STALE_CLAIM_MS = 2 * 60_000;

export type ImportUndoOutcome = {
  status: 'UNDONE' | 'PARTIALLY_UNDONE';
  undone_at: string;
  deleted: number;
  restored: number;
  blocked: number;
  blocked_reasons: Record<string, string>;
};

export type ImportUndoWorkerState = {
  lease_token: string;
  lease_until: string;
  started_at: string;
  heartbeat_at: string;
  actor_user_id: string;
  actor_email: string | null;
  actor_role: string | null;
  /** Status to return to when a claim has to be released without an actor. */
  resume_status: string;
  confirmed_entity_ids: string[];
  /** Keyset cursor over import_job_rows.row_no, or catalog_price_histories.id. */
  cursor: string;
  processed_rows: number;
  total_rows: number;
  /** Committed undo counters; they start from the previous run so re-runs accumulate. */
  deleted_rows: number;
  restored_rows: number;
  /** Keyed by entity id, so re-runs neither inflate nor lose blocked entries. */
  blocked_reasons: Record<string, string>;
};

export type ImportJobOptionsWithUndo = ImportJobOptions & {
  rows_purged?: boolean;
  cancel_reason?: string;
  undo?: ImportUndoOutcome;
  undo_worker?: ImportUndoWorkerState;
};

/**
 * A claim is only adoptable while it still carries its actor and counters. A partial state
 * would leave the run loop without a cursor, and it would hand off to itself forever.
 */
export function readUndoWorkerState(
  options: ImportJobOptionsWithUndo | null | undefined,
): ImportUndoWorkerState | null {
  const worker = options?.undo_worker;
  if (!worker?.lease_token || !worker.actor_user_id) {
    return null;
  }
  if (
    !Number.isFinite(worker.processed_rows) ||
    !Number.isFinite(worker.total_rows)
  ) {
    return null;
  }
  return worker;
}

export function readUndoOutcome(
  options: ImportJobOptionsWithUndo | null | undefined,
): ImportUndoOutcome | null {
  return options?.undo ?? null;
}

export function nextUndoLeaseUntil(nowMs: number): string {
  return new Date(nowMs + IMPORT_UNDO_LEASE_MS).toISOString();
}

export function createUndoWorkerState(params: {
  actorUserId: string;
  actorEmail: string | null;
  actorRole: string | null;
  resumeStatus: string;
  confirmedEntityIds: string[];
  totalRows: number;
  previous?: ImportUndoOutcome | null;
  nowMs?: number;
}): ImportUndoWorkerState {
  const nowMs = params.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  return {
    lease_token: randomUUID(),
    lease_until: nextUndoLeaseUntil(nowMs),
    started_at: now,
    heartbeat_at: now,
    actor_user_id: params.actorUserId,
    actor_email: params.actorEmail,
    actor_role: params.actorRole,
    resume_status: params.resumeStatus,
    confirmed_entity_ids: params.confirmedEntityIds,
    cursor: '0',
    processed_rows: 0,
    total_rows: params.totalRows,
    deleted_rows: params.previous?.deleted ?? 0,
    restored_rows: params.previous?.restored ?? 0,
    blocked_reasons: { ...(params.previous?.blocked_reasons ?? {}) },
  };
}

function readTimestampMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** True when no worker holds the job any more, so a new attempt may take it over. */
export function isUndoClaimStale(
  worker: ImportUndoWorkerState | null,
  nowMs: number,
): boolean {
  if (!worker) {
    return true;
  }
  const leaseUntil = readTimestampMs(worker.lease_until);
  if (leaseUntil === null || leaseUntil <= nowMs) {
    return true;
  }
  const heartbeat = readTimestampMs(worker.heartbeat_at);
  if (heartbeat === null) {
    return true;
  }
  return nowMs - heartbeat >= IMPORT_UNDO_STALE_CLAIM_MS;
}

export function undoLeaseHolderPrefix(
  leaseToken: string | null | undefined,
): string {
  return leaseToken ? leaseToken.slice(0, 8) : 'none';
}

/** Progress of a running undo, mirroring the apply progress shape. */
export function computeUndoProgress(
  worker: ImportUndoWorkerState,
  nowMs: number = Date.now(),
): { processed_rows: number; total_rows: number; eta_seconds: number | null } {
  const totalRows = Math.max(worker.total_rows, worker.processed_rows, 1);
  const startedAt = readTimestampMs(worker.started_at);
  const elapsedSec =
    startedAt !== null && startedAt > 0
      ? Math.max(0.001, (nowMs - startedAt) / 1000)
      : null;
  const etaSeconds =
    elapsedSec !== null && worker.processed_rows > 0
      ? Math.round(
          (elapsedSec / worker.processed_rows) *
            (totalRows - worker.processed_rows),
        )
      : null;
  return {
    processed_rows: worker.processed_rows,
    total_rows: totalRows,
    eta_seconds: etaSeconds,
  };
}
