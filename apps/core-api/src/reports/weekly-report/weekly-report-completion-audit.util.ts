import { WorkshopOrderStatus } from '@prisma/client';

export function isWorkshopOrderStatusCompletionTransition(
  diff: unknown,
): boolean {
  if (!diff || typeof diff !== 'object') {
    return false;
  }
  const statusChange = (diff as Record<string, unknown>).status;
  if (!statusChange || typeof statusChange !== 'object') {
    return false;
  }
  const change = statusChange as { before?: string; after?: string };
  return (
    change.after === WorkshopOrderStatus.COMPLETED &&
    change.before !== WorkshopOrderStatus.COMPLETED
  );
}
