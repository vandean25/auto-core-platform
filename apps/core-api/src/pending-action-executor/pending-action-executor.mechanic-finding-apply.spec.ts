import { PendingActionExecutorService } from './pending-action-executor.service.js';

describe('PendingActionExecutorService workshop_order.mechanic_finding apply', () => {
  const mockMechanicFindingPropose = {
    applyAcknowledgment: jest.fn().mockResolvedValue({
      workshop_order_id: 'order-1',
      workshop_task_id: 'task-1',
      entityId: 'task-1',
    }),
    buildExecutionContext: jest.fn(),
  };

  let service: PendingActionExecutorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PendingActionExecutorService(
      {} as never,
      { getTenantId: jest.fn() } as never,
      { getSiteId: jest.fn().mockResolvedValue('site-1') } as never,
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

  it('routes approval through MechanicFindingProposeService.applyAcknowledgment', async () => {
    const executor = service.resolve('workshop_order.mechanic_finding');
    const payload = { workshop_order_id: 'order-1', workshop_task_id: 'task-1' };
    const context = { site_id: 'site-1' };

    await executor.execute(payload, context);

    expect(mockMechanicFindingPropose.applyAcknowledgment).toHaveBeenCalledWith(
      payload,
      context,
    );
  });
});
