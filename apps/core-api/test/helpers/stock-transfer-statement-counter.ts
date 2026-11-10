import { collectDbStatementsForTest } from './db-statement-counter.js';

const TRANSACTION_BEGIN = /^\s*BEGIN(\s|$)/i;
const TRANSACTION_COMMIT = /^\s*COMMIT(\s|$)/i;
const SESSION_LOCAL = /^\s*SET\s+LOCAL\b/i;
const ADVISORY_LOCK = /^\s*SELECT\s+pg_advisory/i;

/**
 * SQL from other suites (shared Jest worker, global pg Client.prototype spy) that is not
 * part of the stock-transfer HTTP handler but can land in the measurement window.
 */
const CONCURRENT_SUITE_NOISE =
  /\b(invoice|credit_note|document_branding|branding_commit|vehicle_media|import_job|inspector_evidence|mcp_|landing_demo)\b/i;

const RESPONSE_TAIL_TABLE =
  /\b(stock_transfer|storage_locations)\b/i;

export type StockTransferStatementAction =
  | 'create'
  | 'approve'
  | 'ship'
  | 'receive';

function stockTransferHandlerStatements(sql: string[]): string[] {
  const beginIndex = sql.findIndex((statement) =>
    TRANSACTION_BEGIN.test(statement.trim()),
  );
  if (beginIndex < 0) {
    return sql.filter((statement) => !CONCURRENT_SUITE_NOISE.test(statement));
  }

  const measured: string[] = [];
  let commitIndex = beginIndex;
  for (let index = beginIndex; index < sql.length; index += 1) {
    const statement = sql[index];
    if (CONCURRENT_SUITE_NOISE.test(statement)) {
      continue;
    }
    measured.push(statement);
    if (TRANSACTION_COMMIT.test(statement.trim())) {
      commitIndex = index;
      break;
    }
  }

  for (let index = commitIndex + 1; index < sql.length; index += 1) {
    const statement = sql[index];
    if (CONCURRENT_SUITE_NOISE.test(statement)) {
      continue;
    }
    if (!RESPONSE_TAIL_TABLE.test(statement)) {
      break;
    }
    measured.push(statement);
  }

  return measured;
}

export async function countStockTransferActionStatements(
  action: StockTransferStatementAction,
  run: () => Promise<unknown>,
): Promise<number> {
  const debug = process.env.DEBUG_STOCK_TRANSFER_STATEMENTS;
  const sql = await collectDbStatementsForTest(run);
  const measured = stockTransferHandlerStatements(sql);
  if (debug === '1') {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      '/tmp/stock-transfer-statements.log',
      `${action} total=${sql.length} measured=${measured.length}\n`,
    );
  }
  if (debug === 'dump') {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      `/tmp/stock-transfer-${action}-measured.json`,
      JSON.stringify({ all: sql, measured }, null, 2),
    );
  }
  return measured.length;
}
