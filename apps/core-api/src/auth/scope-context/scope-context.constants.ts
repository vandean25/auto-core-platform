export const SCOPE_CONTEXT_HEADER = 'X-ACP-Scope-Context';

/** Firebase ID-token lifetime bound referenced by ADR-0038 §3 / B1 (seconds). */
export const SCOPE_CONTEXT_ID_TOKEN_LIFETIME_SECONDS = 60 * 60;

export const SCOPE_CONTEXT_TOKEN_VERSION = 1;

export const SCOPE_CONTEXT_ECHO_PATHS = [
  '/api/inventory',
  '/api/inventory/capped-count',
  '/api/sales/invoices',
  '/api/sales/invoices/capped-count',
  '/api/vehicle-stock',
  '/api/vehicle-stock/capped-count',
  '/api/workshop/orders',
  '/api/workshop/orders/capped-count',
] as const;

/** Echo paths whose plain GET is an offset list: the digest is echoed only in cursor mode. */
export const SCOPE_CONTEXT_CURSOR_LIST_PATHS = [
  '/api/inventory',
  '/api/sales/invoices',
  '/api/vehicle-stock',
  '/api/workshop/orders',
] as const;

export const SCOPE_CONTEXT_POLICY_OPERATION_IDS = [
  'InventoryController.findAll',
  'InventoryController.cappedCount',
  'SalesController.findAll',
  'SalesController.cappedCount',
  'VehicleStockController.list',
  'VehicleStockController.cappedCount',
  'WorkshopOrdersController.findAll',
  'WorkshopOrdersController.cappedCount',
] as const;
