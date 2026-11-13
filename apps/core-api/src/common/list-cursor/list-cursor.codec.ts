import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LIST_CURSOR_INVALID_CODE,
  LIST_CURSOR_PARAM_FORBIDDEN_CODE,
  LIST_CURSOR_SORT_UNSUPPORTED_CODE,
  LIST_CURSOR_STOCK_FILTER_REQUIRED_CODE,
  LIST_CURSOR_VERSION,
  type ListCursorEndpointId,
} from './list-cursor.constants.js';

export type ListCursorPayload = {
  v: typeof LIST_CURSOR_VERSION;
  ep: ListCursorEndpointId;
  sort: string;
  dir: 'asc' | 'desc';
  fh: string;
  tid: string;
  sid: string;
  sv: string | number | boolean | null;
  id: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSortValue(value: unknown): value is ListCursorPayload['sv'] {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasUuidFields(
  parsed: ListCursorPayload,
  keys: readonly ('tid' | 'id')[],
): boolean {
  return keys.every(
    (key) => typeof parsed[key] === 'string' && UUID_PATTERN.test(parsed[key]),
  );
}

const listCursorFieldChecks: ((parsed: ListCursorPayload) => boolean)[] = [
  (parsed) => parsed.v === LIST_CURSOR_VERSION,
  (parsed) => typeof parsed.ep === 'string',
  (parsed) => isNonEmptyString(parsed.sort),
  (parsed) => parsed.dir === 'asc' || parsed.dir === 'desc',
  (parsed) => isNonEmptyString(parsed.fh),
  (parsed) => typeof parsed.sid === 'string',
  (parsed) => hasUuidFields(parsed, ['tid', 'id']),
  (parsed) => isValidSortValue(parsed.sv),
];

function isListCursorPayload(value: unknown): value is ListCursorPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const parsed = value as ListCursorPayload;
  return listCursorFieldChecks.every((check) => check(parsed));
}

export function encodeListCursor(payload: ListCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeListCursor(encoded: string): ListCursorPayload | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    return isListCursorPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type ListCursorBindingContext = {
  endpoint: ListCursorEndpointId;
  tenantId: string;
  siteId: string;
  filterHash: string;
  sortField: string;
  sortDirection: 'asc' | 'desc';
};

function cursorBindingsMatch(
  decoded: ListCursorPayload,
  context: ListCursorBindingContext,
): boolean {
  return (
    decoded.ep === context.endpoint &&
    decoded.tid === context.tenantId &&
    decoded.sid === context.siteId &&
    decoded.fh === context.filterHash &&
    decoded.sort === context.sortField &&
    decoded.dir === context.sortDirection
  );
}

export function listCursorInvalidException(): BadRequestException {
  return new BadRequestException({
    code: LIST_CURSOR_INVALID_CODE,
    message: 'The list cursor is invalid or does not match this request.',
  });
}

export function listCursorSortUnsupportedException(): BadRequestException {
  return new BadRequestException({
    code: LIST_CURSOR_SORT_UNSUPPORTED_CODE,
    message: 'This sort field is not available in cursor pagination mode.',
  });
}

export function listCursorStockFilterRequiredException(): BadRequestException {
  return new BadRequestException({
    code: LIST_CURSOR_STOCK_FILTER_REQUIRED_CODE,
    message:
      'Vehicle stock cursor paging requires a stock status filter that excludes draft merge rows.',
  });
}

export function listCursorParamForbiddenException(
  param: string,
): BadRequestException {
  return new BadRequestException({
    code: LIST_CURSOR_PARAM_FORBIDDEN_CODE,
    message: `The parameter "${param}" is not allowed in cursor pagination mode.`,
  });
}

/** UTC ISO with millisecond precision, exactly as {@link serializeSortValueForCursor} writes a Date. */
const CURSOR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Strict round trip: anything the server did not write itself is an invalid cursor, never a 500. */
function deserializeCursorDate(serialized: string | number | boolean): Date {
  const text = String(serialized);
  const date = new Date(text);
  if (
    !CURSOR_DATE_PATTERN.test(text) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString() !== text
  ) {
    throw listCursorInvalidException();
  }
  return date;
}

export function parseListCursorParam(
  cursor: string | undefined,
  context: ListCursorBindingContext,
): ListCursorPayload | undefined {
  if (!cursor) {
    return undefined;
  }
  const decoded = decodeListCursor(cursor);
  if (!decoded || !cursorBindingsMatch(decoded, context)) {
    throw listCursorInvalidException();
  }
  return decoded;
}

export function serializeSortValueForCursor(
  value: unknown,
): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Prisma.Decimal.isDecimal(value)) {
    return value.toString();
  }
  throw listCursorInvalidException();
}

export function deserializeSortValueFromCursor(
  serialized: string | number | boolean | null,
  kind: 'string' | 'number' | 'int' | 'decimal' | 'date' | 'enum',
): unknown {
  if (serialized === null) {
    return null;
  }
  switch (kind) {
    case 'number':
      return typeof serialized === 'number' ? serialized : Number(serialized);
    case 'int':
      return typeof serialized === 'number'
        ? Math.trunc(serialized)
        : parseInt(String(serialized), 10);
    case 'decimal':
      return typeof serialized === 'number' ? serialized : String(serialized);
    case 'date':
      return deserializeCursorDate(serialized);
    case 'enum':
    case 'string':
    default:
      return String(serialized);
  }
}
