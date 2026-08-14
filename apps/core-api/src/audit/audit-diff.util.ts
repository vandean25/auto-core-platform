import type { AuditFieldDiff, AuditJsonValue } from './audit.types';
import { redactAuditSecrets } from './audit-redaction.util';

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const isDecimalLike = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const decimalCandidate = value as { toFixed?: unknown; toString?: unknown; constructor?: { name?: string } };
  return (
    typeof decimalCandidate.toFixed === 'function' ||
    decimalCandidate.constructor?.name === 'Decimal'
  );
};

export const normalizeAuditValue = (value: unknown): AuditJsonValue => {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isDecimalLike(value)) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : normalizeAuditValue(item)));
  }

  if (isObject(value)) {
    const normalizedObject: Record<string, AuditJsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) {
        continue;
      }
      normalizedObject[key] = normalizeAuditValue(nestedValue);
    }
    return normalizedObject;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return String(value);
};

const isDeepEqual = (left: AuditJsonValue | undefined, right: AuditJsonValue | undefined): boolean => {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => isDeepEqual(item, right[index]));
  }

  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (let i = 0; i < leftKeys.length; i++) {
      if (leftKeys[i] !== rightKeys[i]) {
        return false;
      }
    }

    return leftKeys.every((key) =>
      isDeepEqual(
        (left as Record<string, AuditJsonValue | undefined>)[key],
        (right as Record<string, AuditJsonValue | undefined>)[key],
      ),
    );
  }

  return false;
};

const asTopLevelObject = (
  value: AuditJsonValue,
): Record<string, AuditJsonValue | undefined> => {
  if (!isObject(value)) {
    return {};
  }

  return value as Record<string, AuditJsonValue | undefined>;
};

export const computeAuditDiff = (
  before: AuditJsonValue,
  after: AuditJsonValue,
): { changedFields: string[]; diff: Record<string, AuditFieldDiff> } => {
  const beforeObject = asTopLevelObject(before);
  const afterObject = asTopLevelObject(after);

  const topLevelFields = [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].sort();
  const diff: Record<string, AuditFieldDiff> = {};

  for (const fieldName of topLevelFields) {
    const previousValue = beforeObject[fieldName];
    const nextValue = afterObject[fieldName];
    if (!isDeepEqual(previousValue, nextValue)) {
      diff[fieldName] = {
        before: previousValue,
        after: nextValue,
      };
    }
  }

  return {
    changedFields: Object.keys(diff).sort(),
    diff,
  };
};

export const buildAuditChangeSet = (
  beforeRaw: unknown,
  afterRaw: unknown,
): {
  before: AuditJsonValue;
  after: AuditJsonValue;
  diff: Record<string, AuditFieldDiff>;
  changedFields: string[];
  redactedFields: string[];
} => {
  const normalizedBefore = normalizeAuditValue(beforeRaw);
  const normalizedAfter = normalizeAuditValue(afterRaw);

  const redactedBefore = redactAuditSecrets(normalizedBefore);
  const redactedAfter = redactAuditSecrets(normalizedAfter);
  const diffResult = computeAuditDiff(redactedBefore.value, redactedAfter.value);

  return {
    before: redactedBefore.value,
    after: redactedAfter.value,
    diff: diffResult.diff,
    changedFields: diffResult.changedFields,
    redactedFields: [...new Set([...redactedBefore.redactedPaths, ...redactedAfter.redactedPaths])].sort(),
  };
};
