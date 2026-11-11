import type { Prisma as PrismaTypes } from '@prisma/client';

export type PurchaseOrderCreateSavepointPort = {
  runInSavepoint<T>(
    tx: PrismaTypes.TransactionClient,
    attempt: number,
    fn: () => Promise<T>,
  ): Promise<T>;
};

async function postgresRunInSavepoint<T>(
  tx: PrismaTypes.TransactionClient,
  attempt: number,
  fn: () => Promise<T>,
): Promise<T> {
  const savepoint = `po_number_alloc_${attempt}`;
  const executeRawUnsafe = (
    tx as PrismaTypes.TransactionClient & {
      $executeRawUnsafe: (query: string) => Promise<unknown>;
    }
  )['$executeRawUnsafe'].bind(tx);
  await executeRawUnsafe(`SAVEPOINT ${savepoint}`);
  try {
    return await fn();
  } catch (error) {
    await executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    throw error;
  }
}

export const postgresPurchaseOrderCreateSavepoint: PurchaseOrderCreateSavepointPort =
  {
    runInSavepoint: postgresRunInSavepoint,
  };

export const passThroughPurchaseOrderCreateSavepoint: PurchaseOrderCreateSavepointPort =
  {
    runInSavepoint: async (_tx, _attempt, fn) => fn(),
  };

let savepointPort: PurchaseOrderCreateSavepointPort =
  postgresPurchaseOrderCreateSavepoint;

export function setPurchaseOrderCreateSavepointPortForTests(
  port: PurchaseOrderCreateSavepointPort,
): void {
  savepointPort = port;
}

export function resetPurchaseOrderCreateSavepointPortForTests(): void {
  savepointPort = postgresPurchaseOrderCreateSavepoint;
}

export function runPurchaseOrderCreateInSavepoint<T>(
  tx: PrismaTypes.TransactionClient,
  attempt: number,
  fn: () => Promise<T>,
): Promise<T> {
  return savepointPort.runInSavepoint(tx, attempt, fn);
}
