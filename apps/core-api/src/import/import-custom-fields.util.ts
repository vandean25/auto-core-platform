import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CustomFieldEntity, CustomFieldType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  CUSTOM_FIELDS_DISABLED_CODE,
  CUSTOM_FIELD_UNKNOWN_OR_ARCHIVED_CODE,
  CUSTOM_FIELD_VALUE_INVALID_CODE,
} from '../custom-fields/custom-fields.constants.js';
import {
  asPlainRecord,
  validateSingleValue,
  type CustomFieldDefinitionLike,
  type CustomFieldScalar,
} from '../custom-fields/custom-fields.validation.js';
import { parseGermanNumber } from './number-parse.util.js';
import type { ImportRowIssue } from './import.types.js';

export const CUSTOM_FIELD_MAPPING_PREFIX = 'custom_fields.';

export type MappedCustomField = {
  key: string;
  csvColumn: string;
};

export function extractCustomFieldMappings(
  mapping: Record<string, string>,
): MappedCustomField[] {
  const result: MappedCustomField[] = [];
  for (const [fieldKey, csvColumn] of Object.entries(mapping)) {
    if (!fieldKey.startsWith(CUSTOM_FIELD_MAPPING_PREFIX)) {
      continue;
    }
    const key = fieldKey.slice(CUSTOM_FIELD_MAPPING_PREFIX.length).trim();
    const column = csvColumn?.trim() ?? '';
    if (!key || !column) {
      continue;
    }
    result.push({ key, csvColumn: column });
  }
  return result;
}

export async function loadValidatedImportCustomFieldDefs(
  prisma: PrismaService,
  tenantId: string,
  entity: CustomFieldEntity,
  mappedFields: readonly MappedCustomField[],
): Promise<Map<string, CustomFieldDefinitionLike>> {
  const defsByKey = new Map<string, CustomFieldDefinitionLike>();
  if (mappedFields.length === 0) {
    return defsByKey;
  }

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: { custom_fields_enabled: true },
  });
  if (!tenant?.custom_fields_enabled) {
    throw new ForbiddenException({
      code: CUSTOM_FIELDS_DISABLED_CODE,
      message: 'Custom fields are not enabled for this tenant.',
    });
  }

  const defs = await prisma.customFieldDefinition.findMany({
    where: {
      tenant_id: tenantId,
      entity,
      archived: false,
    },
    select: {
      key: true,
      type: true,
      options: true,
      archived: true,
    },
  });
  for (const def of defs) {
    defsByKey.set(def.key, def);
  }

  for (const mapped of mappedFields) {
    if (!defsByKey.has(mapped.key)) {
      throw new UnprocessableEntityException({
        code: CUSTOM_FIELD_UNKNOWN_OR_ARCHIVED_CODE,
        message: `Custom field "${mapped.key}" does not exist or is archived.`,
      });
    }
  }

  return defsByKey;
}

function parseDateCell(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const deMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  if (deMatch) {
    const day = deMatch[1].padStart(2, '0');
    const month = deMatch[2].padStart(2, '0');
    const year = deMatch[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

const BOOLEAN_TRUE_VALUES = new Set(['true', '1', 'ja', 'yes', 'j', 'y']);
const BOOLEAN_FALSE_VALUES = new Set(['false', '0', 'nein', 'no', 'n']);

function parseBooleanCell(raw: string): boolean | null {
  const lower = raw.toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(lower)) {
    return true;
  }
  if (BOOLEAN_FALSE_VALUES.has(lower)) {
    return false;
  }
  return null;
}

function coerceCsvCustomFieldValue(
  def: CustomFieldDefinitionLike,
  raw: string,
): unknown {
  switch (def.type) {
    case CustomFieldType.TEXT:
    case CustomFieldType.SELECT:
      return raw;
    case CustomFieldType.NUMBER:
      return parseGermanNumber(raw);
    case CustomFieldType.DATE:
      return parseDateCell(raw);
    case CustomFieldType.BOOLEAN:
      return parseBooleanCell(raw);
  }
}

export function parseAndValidateCustomFieldValues(
  record: Record<string, string>,
  mappedFields: readonly MappedCustomField[],
  defsByKey: ReadonlyMap<string, CustomFieldDefinitionLike>,
): {
  values: Record<string, CustomFieldScalar>;
  issues: ImportRowIssue[];
} {
  const values: Record<string, CustomFieldScalar> = {};
  const issues: ImportRowIssue[] = [];

  for (const { key, csvColumn } of mappedFields) {
    const def = defsByKey.get(key);
    if (!def) {
      continue;
    }
    const raw = record[csvColumn]?.trim() ?? '';
    if (!raw) {
      continue;
    }

    const coerced = coerceCsvCustomFieldValue(def, raw);
    try {
      values[key] = validateSingleValue(def, coerced);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Custom field "${key}" value is invalid.`;
      issues.push({
        code: CUSTOM_FIELD_VALUE_INVALID_CODE,
        message,
        field: `${CUSTOM_FIELD_MAPPING_PREFIX}${key}`,
      });
    }
  }

  return { values, issues };
}

export function mergeCustomFieldValuesForUpdate(
  existingRaw: unknown,
  incoming: Record<string, unknown>,
  fillEmptyOnly: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...asPlainRecord(existingRaw) };
  for (const [key, val] of Object.entries(incoming)) {
    if (val === null || val === undefined || val === '') {
      continue;
    }
    const current = next[key];
    const hasCurrent =
      current !== null &&
      current !== undefined &&
      (typeof current !== 'string' || current.trim() !== '');
    if (fillEmptyOnly && hasCurrent) {
      continue;
    }
    next[key] = val;
  }
  return next;
}

export function extractDryRunCustomFields(
  record: Record<string, string>,
  context:
    | {
        mappedFields: readonly MappedCustomField[];
        defsByKey: ReadonlyMap<string, CustomFieldDefinitionLike>;
      }
    | undefined,
  issues: ImportRowIssue[],
): Record<string, unknown> | undefined {
  if (!context || context.mappedFields.length === 0) {
    return undefined;
  }
  const result = parseAndValidateCustomFieldValues(
    record,
    context.mappedFields,
    context.defsByKey,
  );
  issues.push(...result.issues);
  return Object.keys(result.values).length > 0 ? result.values : undefined;
}

export function pickIncomingCustomFields(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const raw = payload.custom_fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  return Object.keys(record).length > 0 ? record : null;
}

export function areCustomFieldsEqual(
  existingRaw: unknown,
  desiredRaw: unknown,
  fillEmptyOnly: boolean,
): boolean {
  const desired = asPlainRecord(desiredRaw);
  const existing = asPlainRecord(existingRaw);
  for (const [key, val] of Object.entries(desired)) {
    if (val === null || val === undefined || val === '') {
      continue;
    }
    const current = existing[key];
    const hasCurrent =
      current !== null &&
      current !== undefined &&
      (typeof current !== 'string' || current.trim() !== '');
    if (fillEmptyOnly) {
      if (!hasCurrent) {
        return false;
      }
      continue;
    }
    if (current !== val) {
      return false;
    }
  }
  return true;
}
