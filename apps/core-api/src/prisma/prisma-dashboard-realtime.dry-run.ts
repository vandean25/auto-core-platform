import type { DashboardEntityAction } from '../dashboard-realtime/dashboard-events.types.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import {
  actionToDryRunOp,
  extractEntityId,
} from './prisma-dashboard-realtime.mapper.js';

/**
 * Reports one write to the active dry-run collector instead of emitting a realtime event.
 * The caller decides that a dry run is in effect.
 */
export function recordDryRunChange(
  model: string,
  result: unknown,
  action: DashboardEntityAction | null,
): void {
  const collector = DryRunStorage.getCollector();
  if (!collector) {
    return;
  }

  const entityId = extractEntityId(result);
  const op = actionToDryRunOp(action);
  if (entityId && op) {
    collector.recordChange({ entity: model, id: entityId, op });
  }
}

/** createMany reports each row it was asked to create. It never emits realtime events. */
export function recordDryRunCreates(model: string, data: unknown): void {
  const collector = DryRunStorage.getCollector();
  if (!collector) {
    return;
  }

  for (const record of toRecordList(data)) {
    const entityId = extractEntityId(record);
    if (entityId) {
      collector.recordChange({ entity: model, id: entityId, op: 'create' });
    }
  }
}

function toRecordList(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  return data ? [data] : [];
}
