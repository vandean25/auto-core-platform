import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

/**
 * The interactive transaction client currently on the stack. The audit extension needs it to
 * read before/after snapshots: reads through the client captured at extension definition run
 * outside the transaction and see the stale committed row, which silently empties every diff.
 */
export class PrismaTransactionContext {
  private static readonly storage =
    new AsyncLocalStorage<Prisma.TransactionClient>();

  static run<T>(client: Prisma.TransactionClient, callback: () => T): T {
    return this.storage.run(client, callback);
  }

  static getClient(): Prisma.TransactionClient | undefined {
    return this.storage.getStore();
  }
}
