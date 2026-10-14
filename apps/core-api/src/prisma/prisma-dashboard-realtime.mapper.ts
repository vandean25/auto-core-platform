import type { DashboardEntityAction } from '../dashboard-realtime/dashboard-events.types.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';

type DryRunOp = WouldChangeItem['op'];

const ACTION_BY_OPERATION = new Map<string, DashboardEntityAction>([
  ['create', 'CREATED'],
  ['update', 'UPDATED'],
  ['updateMany', 'UPDATED'],
  ['upsert', 'UPDATED'],
  ['delete', 'DELETED'],
  ['deleteMany', 'DELETED'],
]);

const DRY_RUN_OP_BY_ACTION = new Map<DashboardEntityAction, DryRunOp>([
  ['CREATED', 'create'],
  ['UPDATED', 'update'],
  ['DELETED', 'delete'],
]);

/** Maps a Prisma write operation to the realtime action it reports, or null when it reports nothing. */
export function operationToAction(
  operation: string,
): DashboardEntityAction | null {
  return ACTION_BY_OPERATION.get(operation) ?? null;
}

/** Maps a realtime action to the dry-run change op the collector records. */
export function actionToDryRunOp(
  action: DashboardEntityAction | null,
): DryRunOp | undefined {
  return action ? DRY_RUN_OP_BY_ACTION.get(action) : undefined;
}

/** Reads the string `id` of a written row. Batch results and non-string ids yield undefined. */
export function extractEntityId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const candidate = result as { id?: unknown };
  return typeof candidate.id === 'string' ? candidate.id : undefined;
}
