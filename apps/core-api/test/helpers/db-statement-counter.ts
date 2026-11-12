import { jest } from '@jest/globals';
import { Client } from 'pg';

/** Matches an INSERT whose target table is the audit log, schema-qualified or not. */
const AUDIT_LOG_INSERT =
  /^\s*INSERT\s+INTO\s+(?:"?[A-Za-z0-9_$]+"?\s*\.\s*)?"?audit_logs"?\s/i;

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

/** Test-only: returns captured SQL while `action` runs (for diagnosing flaky counts). */
export async function collectDbStatementsForTest(
  action: () => Promise<unknown>,
): Promise<string[]> {
  return collectStatements(action);
}

export type FailedAuditInsertRun<T> = {
  outcome: T;
  /** How many audit_logs INSERTs the action attempted; each one failed at the database. */
  failedAuditInserts: number;
};

/**
 * Runs `action` while every INSERT into the audit log table is replaced by a SQL statement the database
 * rejects, so an audit write fails the way a real INSERT error fails: the driver reports it, the enclosing
 * transaction aborts, and the business change rolls back.
 */
export async function runWithFailingAuditLogInserts<T>(
  action: () => Promise<T>,
): Promise<FailedAuditInsertRun<T>> {
  const clientPrototype = Client.prototype as unknown as {
    query: (...call: unknown[]) => unknown;
  };
  const originalQuery = clientPrototype.query;
  let failedAuditInserts = 0;

  clientPrototype.query = function (this: Client, ...call: unknown[]) {
    if (!AUDIT_LOG_INSERT.test(statementSql(call))) {
      return originalQuery.apply(this, call);
    }
    failedAuditInserts += 1;
    const [, ...rest] = call;
    return originalQuery.apply(this, [
      { text: 'SELECT force_audit_log_insert_failure()', values: [] },
      ...rest,
    ]);
  };

  try {
    return { outcome: await action(), failedAuditInserts };
  } finally {
    clientPrototype.query = originalQuery;
  }
}
