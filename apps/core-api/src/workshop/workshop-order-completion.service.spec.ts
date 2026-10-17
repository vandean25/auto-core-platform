import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkshopOrderCompletionService } from './workshop-order-completion.service.js';
import { proposeWorkshopOrderCompletionInputSchema } from './workshop-order-completion.schema.js';

describe('proposeWorkshopOrderCompletionInputSchema', () => {
  const ORDER_ID = '00000000-0000-4000-8000-000000000001';

  it('defaults notify_customer to false', () => {
    expect(
      proposeWorkshopOrderCompletionInputSchema.parse({
        workshop_order_id: ORDER_ID,
      }).notify_customer,
    ).toBe(false);
  });

  it('rejects odometer_out (not supported on workshop orders)', () => {
    expect(() =>
      proposeWorkshopOrderCompletionInputSchema.parse({
        workshop_order_id: ORDER_ID,
        odometer_out: 1000,
      }),
    ).toThrow();
  });
});

describe('WorkshopOrderCompletionService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const orderId = '00000000-0000-4000-8000-000000000010';
  const taskId = '00000000-0000-4000-8000-000000000011';
  const pinnedTaskId = '00000000-0000-4000-8000-000000000012';

  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: 'ADMIN',
      userId: 'firebase-uid-1',
    }),
  };
  const mockSiteContext = {
    getSiteId: jest.fn().mockResolvedValue(siteId),
  };
  const mockPrisma = {
    site: {
      findFirst: jest.fn().mockResolvedValue({
        id: siteId,
        legal_entity: { name: 'Pilot', is_ready: true },
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    workshopOrder: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  function createService() {
    return new WorkshopOrderCompletionService(
      mockPrisma as never,
      mockTenantContext as never,
      mockSiteContext as never,
      { completeStockPrep: jest.fn() } as never,
      { onOrderCompletedInTx: jest.fn() } as never,
      { enqueue: jest.fn() } as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: orderId,
      status: 'IN_PROGRESS',
      purpose: 'CUSTOMER_REPAIR',
      tasks: [
        { id: taskId, status: 'IN_PROGRESS' },
        { id: pinnedTaskId, status: 'NOT_STARTED' },
      ],
      invoice: null,
    });
  });

  it('rejects a workshop order outside the active site', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue(null);
    const service = createService();
    await expect(
      service.applyCompletion({ workshop_order_id: orderId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an explicit task that is already completed', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: orderId,
      status: 'IN_PROGRESS',
      purpose: 'CUSTOMER_REPAIR',
      tasks: [{ id: taskId, status: 'DONE' }],
      invoice: null,
    });
    const service = createService();
    await expect(
      service.applyCompletion({
        workshop_order_id: orderId,
        workshop_task_ids: [taskId],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enrichInput pins open task ids onto the payload', async () => {
    const service = createService();
    const enriched = await service.enrichInput({
      workshop_order_id: orderId,
    });
    expect(enriched).toMatchObject({
      workshop_order_id: orderId,
      pinned_workshop_task_ids: [taskId, pinnedTaskId],
    });
  });
});
