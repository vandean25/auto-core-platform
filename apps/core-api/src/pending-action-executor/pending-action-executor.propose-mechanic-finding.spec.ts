import { PendingActionExecutorService } from './pending-action-executor.service.js';

describe('PendingActionExecutorService workshop_order.propose_mechanic_finding', () => {
  const mockMechanicFindingPropose = {
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    buildPreview: jest.fn().mockResolvedValue({
      workshop_order_id: 'order-1',
      workshop_task_id: 'task-1',
    }),
  };

  let service: PendingActionExecutorService;

  beforeEach(() => {
    service = new PendingActionExecutorService(
      { site: { updateMany: jest.fn() } } as never,
      { getTenantId: jest.fn() } as never,
      { getSiteId: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      mockMechanicFindingPropose as never,
    );
  });

  it('binds site and delegates dry-run preview to MechanicFindingProposeService', async () => {
    const executor = service.resolve('workshop_order.propose_mechanic_finding');
    const context = await executor.buildExecutionContext?.({});
    expect(context).toEqual({ site_id: 'site-1' });
    await executor.execute(
      {
        workshop_order_id: '00000000-0000-4000-8000-000000000001',
        workshop_task_id: '00000000-0000-4000-8000-000000000006',
        description: 'brake pads worn below limit',
        media_ids: [],
      },
      context,
    );
    expect(mockMechanicFindingPropose.buildPreview).toHaveBeenCalled();
  });
});
