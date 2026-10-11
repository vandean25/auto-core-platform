import { MODULE_METADATA } from '@nestjs/common/constants';
import { WorkshopCapacityController } from './workshop-capacity.controller.js';
import { WorkshopCapacityService } from './workshop-capacity.service.js';
import { WorkshopModule } from './workshop.module.js';

describe('WorkshopModule wiring', () => {
  it('registers the capacity controller and service', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, WorkshopModule);
    const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkshopModule);

    expect(controllers).toContain(WorkshopCapacityController);
    expect(providers).toContain(WorkshopCapacityService);
  });
});
