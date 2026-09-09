import {
  invoicesHistorySlice,
  salesOrdersHistorySlice,
  workshopOrdersHistorySlice,
} from './entity-history.query';

describe('entity-history.query', () => {
  it('builds a paginated sales order history slice', () => {
    expect(salesOrdersHistorySlice({ skip: 10, take: 5 })).toEqual({
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 5,
    });
  });

  it('builds an invoice history slice without skip when omitted', () => {
    expect(invoicesHistorySlice({ take: 20 })).toEqual({
      orderBy: { date: 'desc' },
      take: 20,
    });
  });

  it('builds customer-detail workshop order history with summary line items', () => {
    expect(
      workshopOrdersHistorySlice('customer-detail', { skip: 0, take: 20 }),
    ).toEqual({
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
      include: {
        tasks: {
          include: {
            line_items: {
              select: {
                quantity: true,
                unit_price: true,
              },
            },
          },
        },
        vehicle: true,
      },
    });
  });

  it('builds vehicle-detail workshop order history with invoice summary', () => {
    expect(workshopOrdersHistorySlice('vehicle-detail', { take: 20 })).toEqual(
      {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          tasks: {
            include: {
              line_items: true,
            },
          },
          invoice: {
            select: {
              id: true,
              invoice_number: true,
              status: true,
            },
          },
        },
      },
    );
  });
});
