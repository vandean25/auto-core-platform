import { jest } from '@jest/globals';
import { Client } from 'pg';

/**
 * Counts every SQL statement the pg driver sends while `action` runs, including BEGIN and COMMIT. Wrapping
 * `Client.prototype.query` sees the same statements whether they come from the pool or from an interactive
 * transaction, so the count does not depend on Prisma internals.
 */
export async function countDbStatements(
  action: () => Promise<unknown>,
): Promise<number> {
  const spy = jest.spyOn(Client.prototype, 'query');
  try {
    await action();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}
