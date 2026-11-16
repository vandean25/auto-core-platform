import { createHash } from 'node:crypto';
import { canonicalJson } from '../customer/customer-propose.payload.js';

export type VehicleProposalFields = {
  owner_customer_id?: string | null;
  vin?: string | null;
  plate?: string | null;
  make?: string;
  model?: string;
  variant?: string | null;
  year?: number;
  first_registration_date?: string | null;
  mileage_km?: number | null;
  fuel_type?: string | null;
  national_code?: string | null;
};

export type VehicleCreateFields = VehicleProposalFields & {
  make: string;
  model: string;
};

export type VehicleDuplicateCheck = {
  digest: string;
  candidate_ids: string[];
};

export type VehicleCreateProposalPayload = {
  action: 'vehicle.create';
  idempotency_key: string;
  fields: VehicleCreateFields;
  duplicate_check: VehicleDuplicateCheck;
  warnings: string[];
};

export type VehicleUpdateProposalPayload = {
  action: 'vehicle.update';
  idempotency_key: string;
  vehicle_id: string;
  reason?: string;
  changes: VehicleProposalFields;
  before_digest: string;
  duplicate_check: VehicleDuplicateCheck;
  warnings: string[];
};

export type VehicleProposalDiffEntry = {
  field: string;
  before: string | null;
  after: string | null;
  warning?: string;
};

const FIELD_KEYS = [
  'owner_customer_id',
  'vin',
  'plate',
  'make',
  'model',
  'variant',
  'year',
  'first_registration_date',
  'mileage_km',
  'fuel_type',
  'national_code',
] as const;

export function digestOfVehicleFields(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function formatDiffValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function buildVehicleProposalDiff(
  before: VehicleProposalFields,
  after: VehicleProposalFields,
  warningsByField: Record<string, string> = {},
): VehicleProposalDiffEntry[] {
  const diff: VehicleProposalDiffEntry[] = [];
  for (const field of FIELD_KEYS) {
    const afterVal = after[field];
    if (afterVal === undefined) {
      continue;
    }
    const beforeStr = formatDiffValue(before[field]);
    const afterStr = formatDiffValue(afterVal);
    if (beforeStr === afterStr) {
      continue;
    }
    const warning = warningsByField[field];
    diff.push({
      field,
      before: beforeStr,
      after: afterStr,
      ...(warning ? { warning } : {}),
    });
  }
  return diff;
}
