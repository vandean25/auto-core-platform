import { DRY_RUN_SUPPORTED_KEY } from './dry-run.constants.js';
import { WorkshopOrderTasksController } from '../workshop/workshop-order-tasks.controller.js';
import { WorkshopOrdersController } from '../workshop/workshop-order-crud.controller.js';

describe('Workshop orders dry-run endpoint wiring', () => {
  it('decorates POST /api/workshop/orders (WorkshopOrdersController.create)', () => {
    const isSupported = Reflect.getMetadata(
      DRY_RUN_SUPPORTED_KEY,
      WorkshopOrdersController.prototype.create,
    );
    expect(isSupported).toBe(true);
  });

  it('decorates PATCH /api/workshop/orders/:orderId/tasks/:taskId/line-items (WorkshopOrderTasksController.replaceTaskLineItems)', () => {
    const isSupported = Reflect.getMetadata(
      DRY_RUN_SUPPORTED_KEY,
      WorkshopOrderTasksController.prototype.replaceTaskLineItems,
    );
    expect(isSupported).toBe(true);
  });
});
