import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CustomFieldType, type Prisma } from '@prisma/client';
import { MAX_CUSTOM_FIELD_SELECT_OPTIONS } from './custom-fields.constants.js';
import {
  validateSingleValue,
  type CustomFieldDefinitionLike,
} from './custom-fields.validation.js';

const CUSTOM_FIELD_PARAM =
  /^cf\.([a-z][a-z0-9_]{0,63})(?:\[(eq|contains|gte|lte|in|is)\])?$/;
const OPERATOR_BY_TYPE = {
  TEXT: ['eq', 'contains'],
  NUMBER: ['eq', 'gte', 'lte'],
  DATE: ['eq', 'gte', 'lte'],
  SELECT: ['eq', 'in'],
  BOOLEAN: ['eq', 'is'],
} satisfies Record<CustomFieldType, string[]>;

type CustomFieldClause = {
  custom_fields?: Prisma.JsonFilter;
  OR?: { custom_fields: Prisma.JsonFilter }[];
};

function invalidFilter(): never {
  throw new UnprocessableEntityException({
    code: 'CUSTOM_FIELD_FILTER_INVALID',
    message: 'Check the custom field filter.',
  });
}

function coerceFilterValue(def: CustomFieldDefinitionLike, raw: string) {
  if (def.type === CustomFieldType.NUMBER) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))
      invalidFilter();
    return Number(raw);
  }
  if (def.type === CustomFieldType.BOOLEAN) {
    if (raw !== 'true' && raw !== 'false') invalidFilter();
    return raw === 'true';
  }
  return raw;
}

function filterValue(def: CustomFieldDefinitionLike, raw: string) {
  const value = coerceFilterValue(def, raw);
  try {
    return validateSingleValue(def, value);
  } catch (error) {
    if (error instanceof UnprocessableEntityException) invalidFilter();
    throw error;
  }
}

function buildClause(
  def: CustomFieldDefinitionLike,
  operator: string,
  inputs: string[],
): CustomFieldClause {
  const path = [def.key];
  if (operator === 'in') {
    if (inputs.length > MAX_CUSTOM_FIELD_SELECT_OPTIONS) invalidFilter();
    return {
      OR: [...new Set(inputs)].sort().map((raw) => ({
        custom_fields: { path, equals: filterValue(def, raw) },
      })),
    };
  }
  if (inputs.length !== 1) invalidFilter();
  const [raw] = inputs;
  const value = filterValue(def, raw);
  switch (operator) {
    case 'contains':
      // Prisma emits LIKE for JSON text. Match the literal input, including LIKE metacharacters.
      return {
        custom_fields: {
          path,
          string_contains: raw.replace(/[\\%_]/g, '\\$&'),
        },
      };
    case 'gte':
      return { custom_fields: { path, gte: value } };
    case 'lte':
      return { custom_fields: { path, lte: value } };
    default:
      return { custom_fields: { path, equals: value } };
  }
}

export function buildCustomFieldListFilters(
  definitions: readonly CustomFieldDefinitionLike[] | null,
  params: URLSearchParams | undefined,
): CustomFieldClause[] {
  if (!definitions?.length || !params) return [];
  const active = new Map(definitions.map((def) => [def.key, def]));
  const clauses: CustomFieldClause[] = [];
  for (const name of [...new Set(params.keys())].sort()) {
    if (!name.startsWith('cf.')) continue;
    const def = active.get(name.slice(3).split('[', 1)[0]);
    if (!def) continue;
    const match = CUSTOM_FIELD_PARAM.exec(name);
    const operator = match?.[2] ?? 'eq';
    const allowed: readonly string[] = OPERATOR_BY_TYPE[def.type];
    if (!match || !allowed.includes(operator)) invalidFilter();
    clauses.push(buildClause(def, operator, params.getAll(name)));
  }
  return clauses;
}

export function assertNoCustomFieldFiltersInOffsetMode(
  definitions: readonly CustomFieldDefinitionLike[] | null,
  params: URLSearchParams | undefined,
): void {
  if (!definitions?.length || !params?.size) return;
  const active = new Set(definitions.map((def) => def.key));
  for (const name of params.keys()) {
    if (!name.startsWith('cf.')) continue;
    const key = name.slice(3).split('[', 1)[0];
    if (active.has(key)) {
      throw new BadRequestException({
        code: 'CUSTOM_FIELD_FILTER_REQUIRES_CURSOR',
        message: 'Custom field filters require cursor pagination mode.',
      });
    }
  }
}
