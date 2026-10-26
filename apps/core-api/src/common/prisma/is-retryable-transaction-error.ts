import { Prisma } from '@prisma/client';

const RETRYABLE_PRISMA_CODES = new Set(['P2034', 'P2028', 'P2024']);

const RETRYABLE_PG_SQLSTATES = new Set(['40001', '40P01']);

const CONNECTION_NODE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

function prismaDatabaseSqlState(
  error: Prisma.PrismaClientKnownRequestError,
): string | undefined {
  const meta = error.meta;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  if ('database_error_code' in meta) {
    const code = (meta as { database_error_code?: unknown }).database_error_code;
    return code === undefined ? undefined : String(code);
  }
  return undefined;
}

function isPostgresRetrySqlState(code: string): boolean {
  return RETRYABLE_PG_SQLSTATES.has(code);
}

type DriverAdapterCause = {
  kind?: string;
  code?: string;
};

function readDriverAdapterCause(error: Error): DriverAdapterCause | undefined {
  if (!('cause' in error)) {
    return undefined;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') {
    return undefined;
  }
  return cause as DriverAdapterCause;
}

function isDriverAdapterRetryCause(cause: DriverAdapterCause): boolean {
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

function isConnectionOrPoolMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('connection pool timeout') ||
    lower.includes('connection terminated') ||
    lower.includes('connection reset')
  );
}

function isNodeConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && CONNECTION_NODE_CODES.has(code);
}

/** Deadlocks, write conflicts, pool timeouts and connection loss — not row data problems. */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (RETRYABLE_PRISMA_CODES.has(error.code)) {
      return true;
    }
    const sqlState = prismaDatabaseSqlState(error);
    return sqlState !== undefined && isPostgresRetrySqlState(sqlState);
  }
  if (error instanceof Error && error.name === 'DriverAdapterError') {
    const cause = readDriverAdapterCause(error);
    return cause !== undefined && isDriverAdapterRetryCause(cause);
  }
  if (isNodeConnectionError(error)) {
    return true;
  }
  if (error instanceof Error && isConnectionOrPoolMessage(error.message)) {
    return true;
  }
  return false;
}
