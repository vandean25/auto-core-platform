import { AsyncLocalStorage } from 'node:async_hooks';

type DeferState = { depth: number };

/**
 * Suppresses Prisma dashboard-realtime extension emits while a guarded write is
 * in-flight; callers emit once after the surrounding transaction commits.
 */
export class DashboardRealtimeDeferStorage {
  private static readonly storage = new AsyncLocalStorage<DeferState>();

  static isDeferred(): boolean {
    return (this.storage.getStore()?.depth ?? 0) > 0;
  }

  static async runDeferred<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.run({ depth: 1 }, callback);
  }
}
