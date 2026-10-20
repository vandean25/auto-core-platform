import { customerCreateExecutor } from './pending-action-executor.customer.js';
import type { PendingActionHandlerDeps } from './pending-action-executor.handlers.js';
import type { PendingActionExecutor } from './pending-action-executor.types.js';

export function customerCreatePendingExecutor(
  deps: PendingActionHandlerDeps,
): PendingActionExecutor {
  return customerCreateExecutor(deps, 'customer.create');
}
