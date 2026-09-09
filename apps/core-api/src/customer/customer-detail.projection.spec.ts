import { projectCustomerDetail } from './customer-detail.projection';

describe('projectCustomerDetail', () => {
  it('projects customer detail with history metadata and stripped vehicles', () => {
    const vehicle = {
      id: 'vehicle-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
    };

    const result = projectCustomerDetail(
      {
        id: 'customer-1',
        vehicles: [vehicle],
        sales_orders: [],
        workshop_orders: [{ id: 'order-1', vehicle }],
        invoices: [],
      } as never,
      { page: 2, limit: 10, skip: 10 },
      { workshopOrders: 25, invoices: 5 },
    );

    expect(result.vehicles).toEqual([{ id: 'vehicle-1' }]);
    expect(result.workshop_orders).toEqual([
      { id: 'order-1', vehicle: { id: 'vehicle-1' } },
    ]);
    expect(result.workshop_orders_meta).toEqual({
      page: 2,
      pageSize: 10,
      totalCount: 25,
      pageCount: 3,
      hasMore: true,
    });
    expect(result.invoices_meta).toEqual({
      page: 2,
      pageSize: 10,
      totalCount: 5,
      pageCount: 1,
      hasMore: false,
    });
  });
});
