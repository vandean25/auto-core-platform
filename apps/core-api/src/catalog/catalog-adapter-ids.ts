export const SANDBOX_CATALOG_ADAPTER_IDS = {
  OEM_BMW_PARTS: 'sandbox-oem-bmw-parts',
  OEM_BMW_LABOR: 'sandbox-oem-bmw-labor',
  OEM_MERCEDES_PARTS: 'sandbox-oem-mercedes-parts',
  OEM_MERCEDES_LABOR: 'sandbox-oem-mercedes-labor',
  OEM_STELLANTIS_PARTS: 'sandbox-oem-stellantis-parts',
  OEM_STELLANTIS_LABOR: 'sandbox-oem-stellantis-labor',
  AFTERMARKET_PARTS: 'sandbox-aftermarket-parts',
  AFTERMARKET_LABOR: 'sandbox-aftermarket-labor',
} as const;

export type SandboxCatalogAdapterId =
  (typeof SANDBOX_CATALOG_ADAPTER_IDS)[keyof typeof SANDBOX_CATALOG_ADAPTER_IDS];

export const SANDBOX_CATALOG_QUERY = {
  EMPTY: '__SANDBOX_EMPTY__',
  ERROR: '__SANDBOX_ERROR__',
} as const;
