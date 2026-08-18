import type { AuditJsonValue } from './audit.types';

export const REDACTED_VALUE = '[REDACTED]';

const SECRET_FIELD_NAMES = new Set([
  'password',
  'passwordresettoken',
  'resetpasswordtoken',
  'refreshtoken',
  'accesstoken',
  'xrefreshtoken',
  'xaccesstoken',
  'firebasetoken',
  'apikey',
  'xapikey',
  'authorization',
  'authorizationheader',
]);

const normalizeFieldName = (fieldName: string): string => {
  return fieldName.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const buildPath = (basePath: string, segment: string): string => {
  if (!basePath) {
    return segment;
  }
  if (segment.startsWith('[')) {
    return `${basePath}${segment}`;
  }
  return `${basePath}.${segment}`;
};

const redactValue = (
  value: AuditJsonValue,
  currentPath: string,
  redactedPaths: string[],
): AuditJsonValue => {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      redactValue(entry, buildPath(currentPath, `[${index}]`), redactedPaths),
    );
  }

  if (!isObject(value)) {
    return value;
  }

  const redactedObject: Record<string, AuditJsonValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const path = buildPath(currentPath, key);
    if (SECRET_FIELD_NAMES.has(normalizeFieldName(key))) {
      redactedObject[key] = REDACTED_VALUE;
      redactedPaths.push(path);
      continue;
    }

    redactedObject[key] = redactValue(nestedValue, path, redactedPaths);
  }
  return redactedObject;
};

export const redactAuditSecrets = (
  value: AuditJsonValue,
): { value: AuditJsonValue; redactedPaths: string[] } => {
  const redactedPaths: string[] = [];
  const redactedValue = redactValue(value, '', redactedPaths);

  return {
    value: redactedValue,
    redactedPaths: [...new Set(redactedPaths)].sort(),
  };
};
