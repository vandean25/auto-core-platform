import { Prisma } from '@prisma/client';

const RETRYABLE_PRISMA_CODES = new Set(['P2034', 'P2028', 'P2024']);

const RETRYABLE_PG_SQLSTATES = new Set(['40001', '40P01']);

const CONNECTION_NODE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

const MAX_CAUSE_DEPTH = 8;

function prismaDatabaseSqlState(
  error: Prisma.PrismaClientKnownRequestError,
): string | undefined {
  const meta = error.meta;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  if ('database_error_code' in meta) {
    const code = (meta as { database_error_code?: unknown })
      .database_error_code;
    if (typeof code === 'string') {
      return code;
    }
    if (typeof code === 'number' || typeof code === 'boolean') {
      return String(code);
    }
  }
  return undefined;
}

function isPostgresRetrySqlState(code: string): boolean {
  return RETRYABLE_PG_SQLSTATES.has(code);
}

type AdapterCauseShape = {
  kind?: string;
  code?: string;
};

function readCause(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return undefined;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause === error) {
    return undefined;
  }
  return cause;
}

function adapterCauseFromRecord(
  record: Record<string, unknown>,
): AdapterCauseShape {
  return {
    kind: typeof record.kind === 'string' ? record.kind : undefined,
    code: typeof record.code === 'string' ? record.code : undefined,
  };
}

function isAdapterCauseRetryable(cause: AdapterCauseShape): boolean {
  if (cause.kind === 'TransactionWriteConflict') {
    return true;
  }
  if (
    cause.kind === 'postgres' &&
    typeof cause.code === 'string' &&
    isPostgresRetrySqlState(cause.code)
  ) {
    return true;
  }
  return false;
}

function isNodeConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && CONNECTION_NODE_CODES.has(code);
}

function isRetryablePrismaKnownError(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  if (RETRYABLE_PRISMA_CODES.has(error.code)) {
    return true;
  }
  const sqlState = prismaDatabaseSqlState(error);
  return sqlState !== undefined && isPostgresRetrySqlState(sqlState);
}

function isRetryableAdapterShape(node: unknown): boolean {
  if (node instanceof Error && node.name === 'DriverAdapterError') {
    const cause = readCause(node);
    if (cause && typeof cause === 'object') {
      return isAdapterCauseRetryable(
        adapterCauseFromRecord(cause as Record<string, unknown>),
      );
    }
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.kind === 'string') {
      return isAdapterCauseRetryable(adapterCauseFromRecord(record));
    }
  }
  return false;
}

function isRetryableErrorNode(node: unknown): boolean {
  if (node instanceof Prisma.PrismaClientKnownRequestError) {
    return isRetryablePrismaKnownError(node);
  }
  if (isRetryableAdapterShape(node)) {
    return true;
  }
  return isNodeConnectionError(node);
}

/** Deadlocks, write conflicts, pool timeouts and connection loss — not row data problems. */
export function isRetryableTransactionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    if (isRetryableErrorNode(current)) {
      return true;
    }
    current = readCause(current);
  }
  return false;
}
