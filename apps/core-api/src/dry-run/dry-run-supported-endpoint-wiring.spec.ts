import { DRY_RUN_SUPPORTED_KEY } from './dry-run.constants.js';
import { CustomerController } from '../customer/customer.controller.js';
import { VehicleController } from '../vehicle/vehicle.controller.js';

describe('Dry-run supported endpoint wiring', () => {
  it('decorates POST /api/customers (CustomerController.create)', () => {
    const isSupported = Reflect.getMetadata(
      DRY_RUN_SUPPORTED_KEY,
      CustomerController.prototype.create,
    );
    expect(isSupported).toBe(true);
  });

  it('decorates POST /api/vehicles (VehicleController.create)', () => {
    const isSupported = Reflect.getMetadata(
      DRY_RUN_SUPPORTED_KEY,
      VehicleController.prototype.create,
    );
    expect(isSupported).toBe(true);
  });
});
