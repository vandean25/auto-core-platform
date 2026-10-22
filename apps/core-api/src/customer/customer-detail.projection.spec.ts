import { projectCustomerDetail } from './customer-detail.projection.js';

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
      [],
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

  it('projects vehicle parties with day strings and the active flag', () => {
    const result = projectCustomerDetail(
      {
        id: 'customer-1',
        vehicles: [],
        sales_orders: [],
        workshop_orders: [],
        invoices: [],
        vehicle_parties: [
          {
            id: 'party-1',
            vehicle_id: 'vehicle-1',
            role: 'OWNER',
            valid_from: new Date('2020-01-01T00:00:00.000Z'),
            valid_to: null,
            source: 'MANUAL',
            vehicle: { id: 'vehicle-1', make: 'Synthetic', model: 'Car', plate: null },
          },
          {
            id: 'party-2',
            vehicle_id: 'vehicle-2',
            role: 'PREVIOUS_OWNER',
            valid_from: null,
            valid_to: new Date('2021-01-01T00:00:00.000Z'),
            source: 'LEGACY_IMPORT',
            vehicle: { id: 'vehicle-2', make: 'Synthetic', model: 'Van', plate: 'S-1' },
          },
        ],
      } as never,
      { page: 1, limit: 10, skip: 0 },
      { workshopOrders: 0, invoices: 0 },
      [],
    );

    expect(result.vehicle_parties).toEqual([
      expect.objectContaining({
        id: 'party-1',
        role: 'OWNER',
        valid_from: '2020-01-01',
        valid_to: null,
        is_active: true,
      }),
      expect.objectContaining({
        id: 'party-2',
        role: 'PREVIOUS_OWNER',
        valid_from: null,
        valid_to: '2021-01-01',
        is_active: false,
      }),
    ]);
  });
});
