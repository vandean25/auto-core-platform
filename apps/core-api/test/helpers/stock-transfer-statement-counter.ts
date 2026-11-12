import { collectDbStatementsForTest } from './db-statement-counter.js';

const TRANSACTION_BEGIN = /^\s*BEGIN(\s|$)/i;
const TRANSACTION_COMMIT = /^\s*COMMIT(\s|$)/i;

/** Tables touched by unrelated suites that can appear in the global pg spy window. */
const CONCURRENT_SUITE_NOISE_PATTERN =
  /\b(invoice|credit_note|document_branding|branding_commit|vehicle_media|import_job|inspector_evidence|mcp_|landing_demo)/i;

const RESPONSE_TAIL_PATTERN = /\b(stock_transfer|storage_locations)/i;

export type StockTransferStatementAction =
  | 'create'
  | 'approve'
  | 'ship'
  | 'receive';

export function trimStatementSql(statement: string): string {
  return statement.trim();
}

export function isStockTransferTransactionBegin(statement: string): boolean {
  return TRANSACTION_BEGIN.test(trimStatementSql(statement));
}

export function isStockTransferTransactionCommit(statement: string): boolean {
  return TRANSACTION_COMMIT.test(trimStatementSql(statement));
}

export function isConcurrentSuiteNoiseStatement(statement: string): boolean {
  return CONCURRENT_SUITE_NOISE_PATTERN.test(statement);
}

export function isStockTransferResponseTailStatement(statement: string): boolean {
  return RESPONSE_TAIL_PATTERN.test(statement);
}

export function indexOfFirstBegin(sql: string[]): number {
  return sql.findIndex((statement) => isStockTransferTransactionBegin(statement));
}

export function statementsWithoutConcurrentNoise(sql: string[]): string[] {
  return sql.filter((statement) => !isConcurrentSuiteNoiseStatement(statement));
}

export function transactionWindowStatements(
  sql: string[],
  beginIndex: number,
): { statements: string[]; commitIndex: number } {
  const statements: string[] = [];
  let commitIndex = beginIndex;
  for (let index = beginIndex; index < sql.length; index += 1) {
    const statement = sql[index];
    if (isConcurrentSuiteNoiseStatement(statement)) {
      continue;
    }
    statements.push(statement);
    if (isStockTransferTransactionCommit(statement)) {
      commitIndex = index;
      break;
    }
  }
  return { statements, commitIndex };
}

export function appendResponseTailStatements(
  sql: string[],
  commitIndex: number,
  measured: string[],
): string[] {
  const result = [...measured];
  for (let index = commitIndex + 1; index < sql.length; index += 1) {
    const statement = sql[index];
    if (isConcurrentSuiteNoiseStatement(statement)) {
      continue;
    }
    if (!isStockTransferResponseTailStatement(statement)) {
      break;
    }
    result.push(statement);
  }
  return result;
}

/** Keeps handler SQL from first BEGIN through COMMIT plus transfer response tail reads. */
export function stockTransferHandlerStatements(sql: string[]): string[] {
  const beginIndex = indexOfFirstBegin(sql);
  if (beginIndex < 0) {
    return statementsWithoutConcurrentNoise(sql);
  }
  const window = transactionWindowStatements(sql, beginIndex);
  return appendResponseTailStatements(sql, window.commitIndex, window.statements);
}

async function logMeasuredStatementsForDebug(
  action: StockTransferStatementAction,
  sql: string[],
  measured: string[],
): Promise<void> {
  const mode = process.env.DEBUG_STOCK_TRANSFER_STATEMENTS;
  if (mode === '1') {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      '/tmp/stock-transfer-statements.log',
      `${action} total=${sql.length} measured=${measured.length}\n`,
    );
  }
  if (mode === 'dump') {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      `/tmp/stock-transfer-${action}-measured.json`,
      JSON.stringify({ all: sql, measured }, null, 2),
    );
  }
}

export async function countStockTransferActionStatements(
  action: StockTransferStatementAction,
  run: () => Promise<unknown>,
): Promise<number> {
  const sql = await collectDbStatementsForTest(run);
  const measured = stockTransferHandlerStatements(sql);
  await logMeasuredStatementsForDebug(action, sql, measured);
  return measured.length;
}
