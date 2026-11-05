/** Versioned opaque list cursor payload (ADR-0035). */
export const LIST_CURSOR_VERSION = 1 as const;

/** Stable endpoint identifiers bound into every cursor. */
export const LIST_CURSOR_ENDPOINT = {
  vehicleStock: 'vehicle-stock',
  inventory: 'inventory',
} as const;

export type ListCursorEndpointId =
  (typeof LIST_CURSOR_ENDPOINT)[keyof typeof LIST_CURSOR_ENDPOINT];

export const LIST_CURSOR_INVALID_CODE = 'LIST_CURSOR_INVALID' as const;

export const LIST_COUNT_CAP = 1000 as const;
export const LIST_COUNT_PROBE_TAKE = 1001 as const;

/** Global list page ceiling; vehicle stock uses {@link VEHICLE_STOCK_LIST_LIMIT_MAX}. */
export const GLOBAL_LIST_LIMIT_MAX = 100 as const;
export const VEHICLE_STOCK_LIST_LIMIT_MAX = 50 as const;
