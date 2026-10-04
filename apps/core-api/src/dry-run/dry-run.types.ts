import type { Prisma } from '@prisma/client';
import type { DryRunChangeCollector } from './dry-run-change-collector.js';

export type SideEffectType =
  | 'QUEUE_ENQUEUE'
  | 'EMAIL'
  | 'SMS'
  | 'NOTIFICATION'
  | 'FILE_WRITE'
  | 'GCS_WRITE'
  | 'EXTERNAL_HTTP'
  | 'PERSISTED_AUDIT';

export interface WouldChangeItem {
  entity: string;
  id: string;
  op: 'create' | 'update' | 'delete';
}

export interface DryRunContext {
  isDryRun?: boolean;
  tx?: Prisma.TransactionClient;
  collector?: DryRunChangeCollector;
}
