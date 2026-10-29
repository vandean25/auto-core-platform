import type { Prisma } from '@prisma/client';
import type { DryRunChangeCollector } from './dry-run-change-collector.js';

export type SideEffectType =
  | 'QUEUE_ENQUEUE'
  | 'EMAIL'
  | 'SMS'
  | 'PUSH'
  | 'NOTIFICATION'
  | 'FILE_WRITE'
  | 'GCS_WRITE'
  | 'EXTERNAL_HTTP'
  | 'PERSISTED_AUDIT';

export interface WouldChangeItem {
  entity: string;
  id: string;
  op: 'create' | 'update' | 'delete';
  /**
   * True when `id` is not a committed row id. A preview runs in a rolled-back transaction, so a row it
   * creates (or changes after creating) exists only inside the preview. Do not reuse such an id as the
   * row to act on; use the id the committed write returns.
   */
  provisional: boolean;
}

/** One change as a write reports it. The collector sets `provisional` when it records the change. */
export type WouldChangeRecord = Omit<WouldChangeItem, 'provisional'>;

export interface DryRunContext {
  isDryRun?: boolean;
  tx?: Prisma.TransactionClient;
  collector?: DryRunChangeCollector;
}
