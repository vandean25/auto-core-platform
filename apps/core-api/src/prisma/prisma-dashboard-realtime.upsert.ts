import { toPrismaDelegateKey } from './prisma-delegate.js';

type ExistenceDelegate = {
  findFirst?: (args: {
    where: unknown;
    select: { id: boolean };
  }) => Promise<unknown>;
};

/**
 * Reports whether an upsert's `where` already matches a row, so the realtime event says CREATED
 * or UPDATED. Must run before the upsert query, which changes the answer.
 */
export async function upsertTargetExists(
  ctx: Record<string, unknown>,
  model: string,
  where: unknown,
): Promise<boolean> {
  const delegateKey = toPrismaDelegateKey(model);
  const modelDelegate = (ctx[delegateKey] ?? ctx[model]) as
    ExistenceDelegate | undefined;
  if (typeof modelDelegate?.findFirst !== 'function') {
    return false;
  }

  const existing = await modelDelegate.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(existing);
}
