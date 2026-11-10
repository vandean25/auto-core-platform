export const SCOPE_CONTEXT_HEADER = 'X-ACP-Scope-Context';

/** Firebase ID-token lifetime bound referenced by ADR-0038 §3 / B1 (seconds). */
export const SCOPE_CONTEXT_ID_TOKEN_LIFETIME_SECONDS = 60 * 60;

export const SCOPE_CONTEXT_TOKEN_VERSION = 1;

export const SCOPE_CONTEXT_POLICY_OPERATION_IDS = [
  'InventoryController.findAll',
  'InventoryController.cappedCount',
  'SalesController.findAll',
  'SalesController.cappedCount',
  'VehicleStockController.list',
  'VehicleStockController.cappedCount',
] as const;
