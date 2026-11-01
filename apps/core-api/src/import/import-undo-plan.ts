import { ImportRowAction } from '@prisma/client';
import type { CatalogPriceHistory, ImportJobRow } from '@prisma/client';
import {
  checkEntitiesUndoEligibility,
  isUndoSupportedEntityType,
} from './import-undo.guard.js';
import { isRestorableEntityType } from './import-undo-writer.js';
import {
  UNDO_BLOCKED_REASONS,
  type ImportUndoEligibility,
  type UndoGuardPrismaClient,
} from './import-undo.types.js';

export const SUPPLIER_PRICE_LIST_ENTITY_TYPE = 'SUPPLIER_PRICE_LIST';

export type UndoRowPlanItem = {
  row: ImportJobRow;
  key: string;
  action: 'delete' | 'restore' | null;
  reason?: string;
  entity?: unknown;
};

export type UndoPricePlanItem = {
  history: CatalogPriceHistory;
  key: string;
  action: 'restore' | null;
  reason?: string;
};

export type UndoPlanParams = {
  tenantId: string;
  entityType: string;
  appliedAt: Date;
  confirmedEntityIds: Set<string>;
};

export function undoRowKey(row: ImportJobRow): string {
  return row.entity_id ?? `row-${row.row_no}`;
}

function isUndoBlocked(
  eligibility: ImportUndoEligibility,
  entityId: string,
  confirmedEntityIds: Set<string>,
): boolean {
  return (
    eligibility.status === 'BLOCKED' ||
    (eligibility.status === 'CONFLICT' && !confirmedEntityIds.has(entityId))
  );
}

function getRowStaticBlockReason(
  row: ImportJobRow,
  entityType: string,
): string | null {
  if (!row.entity_id) {
    return UNDO_BLOCKED_REASONS.UNKNOWN;
  }
  if (row.action === ImportRowAction.UPDATE && !row.before_snapshot_json) {
    return UNDO_BLOCKED_REASONS.MISSING_BEFORE_SNAPSHOT;
  }
  if (
    !isUndoSupportedEntityType(entityType) ||
    (row.action === ImportRowAction.UPDATE &&
      !isRestorableEntityType(entityType))
  ) {
    return UNDO_BLOCKED_REASONS.UNSUPPORTED_ENTITY_TYPE;
  }
  return null;
}

/** Decides every row of a batch with one batched eligibility lookup, never one query per row. */
export async function planUndoRows(
  client: UndoGuardPrismaClient,
  params: UndoPlanParams,
  rows: ImportJobRow[],
): Promise<UndoRowPlanItem[]> {
  const entityIds = rows
    .map((row) => row.entity_id)
    .filter((id): id is string => Boolean(id));
  const eligibility = await checkEntitiesUndoEligibility(
    client,
    params.tenantId,
    params.entityType,
    entityIds,
    params.appliedAt,
  );
  return rows.map((row) => planUndoRow(row, params, eligibility));
}

function planUndoRow(
  row: ImportJobRow,
  params: UndoPlanParams,
  eligibility: Map<string, ImportUndoEligibility>,
): UndoRowPlanItem {
  const key = undoRowKey(row);
  const staticReason = getRowStaticBlockReason(row, params.entityType);
  if (staticReason) {
    return { row, key, action: null, reason: staticReason };
  }
  const entityId = row.entity_id as string;
  const check = eligibility.get(entityId);
  if (!check) {
    return {
      row,
      key,
      action: null,
      reason: UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND,
    };
  }
  if (isUndoBlocked(check, entityId, params.confirmedEntityIds)) {
    return {
      row,
      key,
      action: null,
      reason: check.reason ?? UNDO_BLOCKED_REASONS.UNKNOWN,
    };
  }
  if (row.action === ImportRowAction.CREATE) {
    return { row, key, action: 'delete', entity: check.entity };
  }
  return { row, key, action: 'restore', entity: check.entity };
}

/**
 * Plans one supplier price-list batch. Blocked entries keep their history row, so the
 * caller's keyset cursor is what guarantees every entry is visited exactly once.
 */
export async function planUndoPriceEntries(
  client: UndoGuardPrismaClient,
  params: UndoPlanParams,
  histories: CatalogPriceHistory[],
): Promise<UndoPricePlanItem[]> {
  const eligibility = await checkEntitiesUndoEligibility(
    client,
    params.tenantId,
    'CATALOG_ITEM',
    histories.map((history) => history.catalog_item_id),
    params.appliedAt,
  );
  return histories.map((history) => {
    const key = history.catalog_item_id;
    if (history.old_cost == null) {
      return {
        history,
        key,
        action: null,
        reason: UNDO_BLOCKED_REASONS.MISSING_BEFORE_SNAPSHOT,
      };
    }
    const check = eligibility.get(key);
    if (!check) {
      return {
        history,
        key,
        action: null,
        reason: UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND,
      };
    }
    if (isUndoBlocked(check, key, params.confirmedEntityIds)) {
      return {
        history,
        key,
        action: null,
        reason: check.reason ?? UNDO_BLOCKED_REASONS.UNKNOWN,
      };
    }
    return { history, key, action: 'restore' as const };
  });
}
