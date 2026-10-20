import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopIntakeService } from './workshop-intake.service.js';
import { WorkshopInvoiceService } from './workshop-invoice.service.js';
import { WorkshopOrdersController } from './workshop-orders.controller.js';

describe('WorkshopOrdersController', () => {
  it('delegates create to intake service', async () => {
    const intakeService = { create: jest.fn().mockReturnValue({ id: 'o-1' }) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkshopOrdersController],
      providers: [
        { provide: WorkshopIntakeService, useValue: intakeService },
        { provide: WorkshopInvoiceService, useValue: {} },
      ],
    }).compile();

    const controller = module.get(WorkshopOrdersController);
    const dto = { vehicle_id: 'v-1' } as Parameters<
      WorkshopOrdersController['create']
    >[0];

    expect(controller.create(dto)).toEqual({ id: 'o-1' });
    expect(intakeService.create).toHaveBeenCalledWith(dto);
  });
});
