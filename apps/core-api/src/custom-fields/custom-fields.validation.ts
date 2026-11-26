import { UnprocessableEntityException } from '@nestjs/common';
import { CustomFieldType } from '@prisma/client';
import {
  CUSTOM_FIELD_SELECT_OPTIONS_REQUIRED_CODE,
  CUSTOM_FIELD_UNKNOWN_OR_ARCHIVED_CODE,
  CUSTOM_FIELD_VALUE_INVALID_CODE,
  MAX_CUSTOM_FIELD_KEY_LENGTH,
  MAX_CUSTOM_FIELD_SELECT_OPTIONS,
  MAX_CUSTOM_FIELD_SELECT_OPTION_LENGTH,
  MAX_CUSTOM_FIELD_TEXT_LENGTH,
} from './custom-fields.constants.js';

export type CustomFieldDefinitionLike = {
  key: string;
  type: CustomFieldType;
  options: unknown;
  archived: boolean;
};

export type CustomFieldScalar = string | number | boolean;

const KEY_SLUG_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeCustomFieldKey(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[\s-]+/g, '_');

  if (
    normalized.length === 0 ||
    normalized.length > MAX_CUSTOM_FIELD_KEY_LENGTH ||
    !KEY_SLUG_PATTERN.test(normalized)
  ) {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_VALUE_INVALID_CODE,
      message:
        'Custom field key must be a lowercase slug starting with a letter (a-z, 0-9, _).',
    });
  }
  return normalized;
}

export function validateSelectOptions(
  type: CustomFieldType,
  options: unknown,
): string[] | null {
  if (type !== CustomFieldType.SELECT) {
    return null;
  }
  if (!Array.isArray(options) || options.length === 0) {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_SELECT_OPTIONS_REQUIRED_CODE,
      message: 'SELECT custom fields require at least one option.',
    });
  }
  if (options.length > MAX_CUSTOM_FIELD_SELECT_OPTIONS) {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_VALUE_INVALID_CODE,
      message: `SELECT custom fields support at most ${MAX_CUSTOM_FIELD_SELECT_OPTIONS} options.`,
    });
  }

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of options) {
    if (typeof raw !== 'string') {
      throw new UnprocessableEntityException({
        code: CUSTOM_FIELD_VALUE_INVALID_CODE,
        message: 'SELECT options must be non-empty strings.',
      });
    }
    const trimmed = raw.trim();
    if (
      trimmed.length === 0 ||
      trimmed.length > MAX_CUSTOM_FIELD_SELECT_OPTION_LENGTH
    ) {
      throw new UnprocessableEntityException({
        code: CUSTOM_FIELD_VALUE_INVALID_CODE,
        message: `Each SELECT option must be between 1 and ${MAX_CUSTOM_FIELD_SELECT_OPTION_LENGTH} characters.`,
      });
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

function isValidIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateTextValue(key: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_VALUE_INVALID_CODE,
      message: `Custom field "${key}" expects a text string.`,
    });
  }
  if (value.length > MAX_CUSTOM_FIELD_TEXT_LENGTH) {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_VALUE_INVALID_CODE,
      message: `Custom field "${key}" exceeds max length of ${MAX_CUSTOM_FIELD_TEXT_LENGTH}.`,
    });
  }
  return value;
}

function validateSelectValue(
  def: CustomFieldDefinitionLike,
  value: unknown,
): string {
  const options = Array.isArray(def.options)
    ? def.options.filter((item): item is string => typeof item === 'string')
    : [];
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_VALUE_INVALID_CODE,
      message: `Custom field "${def.key}" must be one of the configured options.`,
    });
  }
  return value;
}

export function validateSingleValue(
  def: CustomFieldDefinitionLike,
  value: unknown,
): CustomFieldScalar {
  switch (def.type) {
    case CustomFieldType.TEXT:
      return validateTextValue(def.key, value);
    case CustomFieldType.NUMBER:
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new UnprocessableEntityException({
          code: CUSTOM_FIELD_VALUE_INVALID_CODE,
          message: `Custom field "${def.key}" expects a finite number.`,
        });
      }
      return value;
    case CustomFieldType.DATE:
      if (typeof value !== 'string' || !isValidIsoCalendarDate(value)) {
        throw new UnprocessableEntityException({
          code: CUSTOM_FIELD_VALUE_INVALID_CODE,
          message: `Custom field "${def.key}" expects a valid YYYY-MM-DD date.`,
        });
      }
      return value;
    case CustomFieldType.BOOLEAN:
      if (typeof value !== 'boolean') {
        throw new UnprocessableEntityException({
          code: CUSTOM_FIELD_VALUE_INVALID_CODE,
          message: `Custom field "${def.key}" expects a boolean.`,
        });
      }
      return value;
    case CustomFieldType.SELECT:
      return validateSelectValue(def, value);
  }
}

export function asPlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function validateAndMergeCustomFieldValues(
  definitions: readonly CustomFieldDefinitionLike[],
  existingRaw: unknown,
  incomingRaw: Record<string, unknown>,
): Record<string, CustomFieldScalar> {
  const byKey = new Map(definitions.map((def) => [def.key, def]));
  const result: Record<string, CustomFieldScalar> = {};

  for (const [key, val] of Object.entries(asPlainRecord(existingRaw))) {
    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
    ) {
      result[key] = val;
    }
  }

  for (const [key, rawValue] of Object.entries(incomingRaw)) {
    const def = byKey.get(key);
    if (!def || def.archived) {
      throw new UnprocessableEntityException({
        code: CUSTOM_FIELD_UNKNOWN_OR_ARCHIVED_CODE,
        message: `Custom field "${key}" does not exist or is archived.`,
      });
    }
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      delete result[key];
      continue;
    }
    result[key] = validateSingleValue(def, rawValue);
  }

  return result;
}

export function filterVisibleCustomFieldValues(
  rawValues: unknown,
  activeDefinitions: ReadonlyArray<{ key: string }>,
): Record<string, CustomFieldScalar> {
  const activeKeys = new Set(activeDefinitions.map((d) => d.key));
  const visible: Record<string, CustomFieldScalar> = {};
  for (const [key, val] of Object.entries(asPlainRecord(rawValues))) {
    if (
      activeKeys.has(key) &&
      (typeof val === 'string' ||
        typeof val === 'number' ||
        typeof val === 'boolean')
    ) {
      visible[key] = val;
    }
  }
  return visible;
}

export function omitCustomFields<T extends { custom_fields?: unknown }>(
  obj: T,
): Omit<T, 'custom_fields'> {
  const copy = { ...obj };
  delete copy.custom_fields;
  return copy;
}
