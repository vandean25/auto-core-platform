import { customerUpdateExecutor } from './pending-action-executor.customer.js';
import { customerCreatePendingExecutor } from './pending-action-executor.registry.customer-create.js';
import { PendingActionExecutorService as PendingActionExecutorServiceCore } from './pending-action-executor.registry.js';
import type { PendingActionExecutor } from './pending-action-executor.types.js';
import {
  vehicleCreateExecutor,
  vehicleUpdateExecutor,
} from './pending-action-executor.vehicle.js';

export class PendingActionExecutorService extends PendingActionExecutorServiceCore {
  resolve(actionType: string): PendingActionExecutor {
    if (actionType === 'customer.create') {
      return customerCreatePendingExecutor(this);
    }
    if (actionType === 'customer.update') {
      return customerUpdateExecutor(this, 'customer.update');
    }
    if (actionType === 'vehicle.create') {
      return vehicleCreateExecutor(this, 'vehicle.create');
    }
    if (actionType === 'vehicle.update') {
      return vehicleUpdateExecutor(this, 'vehicle.update');
    }
    return super.resolve(actionType);
  }
}

export type { PendingActionExecutor } from './pending-action-executor.types.js';
