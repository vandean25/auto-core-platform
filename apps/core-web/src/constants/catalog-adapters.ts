export const CATALOG_ADAPTER_OPTIONS = {
  identity: [
    { value: 'sandbox-vehicle-identity', label: 'Sandbox — Vehicle identity' },
  ],
  partsAftermarket: [
    { value: 'sandbox-aftermarket-parts', label: 'Sandbox — Aftermarket parts' },
  ],
  laborAftermarket: [
    { value: 'sandbox-aftermarket-labor', label: 'Sandbox — Aftermarket labor' },
  ],
} as const

export const OEM_CONCERN_CODES = ['BMW', 'MERCEDES', 'STELLANTIS'] as const
export type OemConcernCode = (typeof OEM_CONCERN_CODES)[number]

export const OEM_CONCERN_LABELS: Record<OemConcernCode, string> = {
  BMW: 'BMW',
  MERCEDES: 'Mercedes-Benz',
  STELLANTIS: 'Stellantis',
}
