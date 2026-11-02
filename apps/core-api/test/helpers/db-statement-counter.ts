import { jest } from '@jest/globals';
import { Client } from 'pg';

/** Matches an INSERT whose target table is the audit log, schema-qualified or not. */
const AUDIT_LOG_INSERT =
  /^\s*INSERT\s+INTO\s+(?:"?[A-Za-z0-9_$]+"?\s*\.\s*)?"?audit_logs"?\s/i;

export type DbStatementCounts = {
  /** Statements that must stay constant when the line count grows. */
  counted: number;
  /** INSERTs into the audit log table, reported so they cannot hide other growth. */
  auditLogInserts: number;
};

function statementSql(call: unknown[]): string {
  const target = call[0];
  if (typeof target === 'string') {
    return target;
  }
  const text = (target as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

async function collectStatements(
  action: () => Promise<unknown>,
): Promise<string[]> {
  const spy = jest.spyOn(Client.prototype, 'query');
  try {
    await action();
    return spy.mock.calls.map(statementSql);
  } finally {
    spy.mockRestore();
  }
}

/**
 * Counts every SQL statement the pg driver sends while `action` runs, including BEGIN and COMMIT. Wrapping
 * `Client.prototype.query` sees the same statements whether they come from the pool or from an interactive
 * transaction, so the count does not depend on Prisma internals.
 */
export async function countDbStatements(
  action: () => Promise<unknown>,
): Promise<number> {
  return (await collectStatements(action)).length;
}

/**
 * Same count as `countDbStatements`, with INSERTs into the audit log table separated out so a caller can
 * exclude the one audited write per line from the compared total while still asserting how many there were.
 */
export async function countDbStatementsWithoutAuditLogInserts(
  action: () => Promise<unknown>,
): Promise<DbStatementCounts> {
  const statements = await collectStatements(action);
  const auditLogInserts = statements.filter((sql) =>
    AUDIT_LOG_INSERT.test(sql),
  ).length;

  return { counted: statements.length - auditLogInserts, auditLogInserts };
}
