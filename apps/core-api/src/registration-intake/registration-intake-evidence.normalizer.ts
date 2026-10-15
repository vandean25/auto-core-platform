import {
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
} from '../vehicle/vehicle-identity.util.js';
import type { RegistrationFieldEvidence } from './registration-document-extraction.types.js';
import { REGISTRATION_INTAKE_LOW_CONFIDENCE_THRESHOLD } from './registration-intake-limits.js';

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const NATIONALCODE_PATTERN = /^[A-Z0-9]{2,16}$/;

function isLowConfidence(field: RegistrationFieldEvidence | undefined): boolean {
  if (!field) {
    return true;
  }
  if (field.absence === 'CONFIDENT') {
    return false;
  }
  if (field.uncertainty === null) {
    return field.normalized === null;
  }
  return field.uncertainty > REGISTRATION_INTAKE_LOW_CONFIDENCE_THRESHOLD;
}

function mergeField(
  left: RegistrationFieldEvidence | undefined,
  right: RegistrationFieldEvidence | undefined,
): RegistrationFieldEvidence | undefined {
  if (!left) return right;
  if (!right) return left;
  const leftU = left.uncertainty ?? 1;
  const rightU = right.uncertainty ?? 1;
  if (leftU < rightU) {
    if (
      left.normalized !== null &&
      right.normalized !== null &&
      JSON.stringify(left.normalized) !== JSON.stringify(right.normalized)
    ) {
      return {
        ...left,
        uncertainty: 1,
        alternate: right,
      };
    }
    return left;
  }
  if (rightU < leftU) {
    if (
      left.normalized !== null &&
      right.normalized !== null &&
      JSON.stringify(left.normalized) !== JSON.stringify(right.normalized)
    ) {
      return {
        ...right,
        uncertainty: 1,
        alternate: left,
      };
    }
    return right;
  }
  if (
    left.normalized !== null &&
    right.normalized !== null &&
    JSON.stringify(left.normalized) !== JSON.stringify(right.normalized)
  ) {
    return { ...left, uncertainty: 1, alternate: right };
  }
  return left;
}

export function mergeRegistrationFieldMaps(
  maps: Record<string, RegistrationFieldEvidence>[],
): Record<string, RegistrationFieldEvidence> {
  const merged: Record<string, RegistrationFieldEvidence> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      merged[key] = mergeField(merged[key], value) ?? value;
    }
  }
  return merged;
}

export function normalizeRegistrationEvidenceFields(
  fields: Record<string, RegistrationFieldEvidence>,
  vin: string | null,
): { fields: Record<string, RegistrationFieldEvidence>; cases: string[] } {
  const cases: string[] = [];
  const next = { ...fields };

  if (next.vin) {
    const normalized = normalizeVehicleIdentityValueOrNull(
      typeof next.vin.normalized === 'string' ? next.vin.normalized : null,
    );
    if (normalized && !VIN_PATTERN.test(normalized)) {
      next.vin = { ...next.vin, uncertainty: 1 };
      cases.push('INVALID_VIN');
    } else if (normalized) {
      next.vin = { ...next.vin, normalized };
    }
  }

  if (next.plate?.normalized && typeof next.plate.normalized === 'string') {
    next.plate = {
      ...next.plate,
      normalized: normalizeVehicleIdentityValue(next.plate.normalized),
    };
  }

  if (next.nationalcode) {
    let code =
      typeof next.nationalcode.normalized === 'string'
        ? next.nationalcode.normalized
        : null;
    if (code) {
      code = code.normalize('NFC').trim().replace(/\s+/g, '').toUpperCase();
      if (!NATIONALCODE_PATTERN.test(code)) {
        next.nationalcode = { ...next.nationalcode, normalized: null, uncertainty: 1 };
      } else if (code.length === 17 || code === vin) {
        next.nationalcode = {
          ...next.nationalcode,
          normalized: null,
          uncertainty: 1,
        };
        cases.push('NATIONALCODE_LOOKS_LIKE_VIN');
      } else {
        next.nationalcode = { ...next.nationalcode, normalized: code };
      }
    }
  }

  if (
    next.vin &&
    (isLowConfidence(next.vin) ||
      isLowConfidence(next.plate) ||
      isLowConfidence(next.holder) ||
      (next.nationalcode &&
        next.nationalcode.absence !== 'CONFIDENT' &&
        isLowConfidence(next.nationalcode)))
  ) {
    cases.push('LOW_CONFIDENCE');
  }

  if (
    next.vin &&
    next.vin.alternate &&
    next.vin.uncertainty === 1 &&
    JSON.stringify(next.vin.normalized) !==
      JSON.stringify(next.vin.alternate.normalized)
  ) {
    cases.push('FIELD_SIDE_CONFLICT');
  }

  if (next.nationalcode?.absence === 'CONFIDENT') {
    cases.push('MISSING_NATIONALCODE');
  }

  if (
    next.co2 &&
    next.co2.normalized !== null &&
    !next.co2.cycle &&
    next.co2.uncertainty !== null
  ) {
    cases.push('CO2_CYCLE_UNKNOWN');
  }

  return { fields: next, cases };
}

export function fieldSideConflict(fields: Record<string, RegistrationFieldEvidence>): boolean {
  return Object.values(fields).some(
    (field) =>
      field.uncertainty === 1 &&
      field.alternate &&
      field.normalized !== null &&
      field.alternate.normalized !== null &&
      JSON.stringify(field.normalized) !== JSON.stringify(field.alternate.normalized),
  );
}

export { isLowConfidence, VIN_PATTERN };
