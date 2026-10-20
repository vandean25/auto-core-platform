import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopOrdersController } from './workshop-orders.controller.js';
import { WorkshopOrdersHttpHandlers } from './workshop-orders.http-handlers.js';

describe('WorkshopOrdersController', () => {
  it('delegates create to orders handlers', async () => {
    const handlers = { create: jest.fn().mockReturnValue({ id: 'o-1' }) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkshopOrdersController],
      providers: [{ provide: WorkshopOrdersHttpHandlers, useValue: handlers }],
    }).compile();

    const controller = module.get(WorkshopOrdersController);
    const dto = { vehicle_id: 'v-1' } as Parameters<
      WorkshopOrdersController['create']
    >[0];

    expect(controller.create(dto)).toEqual({ id: 'o-1' });
    expect(handlers.create).toHaveBeenCalledWith(dto);
  });
});
