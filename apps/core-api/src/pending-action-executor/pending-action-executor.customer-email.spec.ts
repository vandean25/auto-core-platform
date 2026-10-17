import { PendingActionExecutorService } from './pending-action-executor.service.js';

// An approved customer.update must withdraw the advisor's email confirmation when the address changes (ADR-0025 §8).
describe('customer.update and the estimate email confirmation', () => {
  const mockPrisma = {
    customer: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const mockTenant = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };

  function customerUpdate() {
    const service = new PendingActionExecutorService(
      mockPrisma as never,
      mockTenant as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return service.resolve('customer.update');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'customer-1',
      email: 'alt@example.at',
    });
  });

  it('withdraws the confirmation when the approved update changes the address', async () => {
    await customerUpdate().execute({
      customer_id: 'customer-1',
      email: 'neu@example.at',
    });

    expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'customer-1', tenant_id: 'tenant-1' },
      data: { email: 'neu@example.at', contact_email_ok: false },
    });
  });

  it('keeps the confirmation when the approved update repeats the address', async () => {
    await customerUpdate().execute({
      customer_id: 'customer-1',
      first_name: 'Max',
      email: 'alt@example.at',
    });

    const written = mockPrisma.customer.updateMany.mock.calls[0][0].data;
    expect(written).toEqual({ first_name: 'Max', email: 'alt@example.at' });
  });
});
