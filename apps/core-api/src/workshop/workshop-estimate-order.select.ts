import type { Prisma } from '@prisma/client';

export const ORDER_FOR_ESTIMATE_SELECT = {
  id: true,
  site_id: true,
  status: true,
  order_number: true,
  odometer: true,
  customer: true,
  vehicle: {
    select: { make: true, model: true, year: true, vin: true, plate: true },
  },
  tasks: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      line_items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          item_no: true,
          description: true,
          quantity: true,
          unit_price: true,
          part_execution_status: true,
          fitment_notes: true,
        },
      },
    },
  },
} satisfies Prisma.WorkshopOrderSelect;

export type OrderForEstimate = Prisma.WorkshopOrderGetPayload<{
  select: typeof ORDER_FOR_ESTIMATE_SELECT;
}>;

export type EstimateDbClient = Pick<Prisma.TransactionClient, 'workshopOrder'>;
