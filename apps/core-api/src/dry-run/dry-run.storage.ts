import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import type { DryRunContext } from './dry-run.types.js';
import type { DryRunChangeCollector } from './dry-run-change-collector.js';

export class DryRunStorage {
  private static readonly storage = new AsyncLocalStorage<DryRunContext>();

  static run<T>(context: DryRunContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  static isDryRun(): boolean {
    return Boolean(this.storage.getStore()?.isDryRun);
  }

  static getTransactionClient(): Prisma.TransactionClient | undefined {
    return this.storage.getStore()?.tx;
  }

  static getCollector(): DryRunChangeCollector | undefined {
    return this.storage.getStore()?.collector;
  }

  static getStore(): DryRunContext | undefined {
    return this.storage.getStore();
  }
}
