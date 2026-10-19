import { ZodError } from 'zod';
import {
  getCheckInInputSchema,
  getStaffAvailabilityInputSchema,
  listEstimatesInputSchema,
  listLoanerBookingsInputSchema,
  listOrderCommunicationsInputSchema,
} from './mcp-read-wave2-schemas.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';

describe('mcp-read-wave2-schemas', () => {
  describe('list_loaner_bookings', () => {
    it('accepts paging and rejects an invalid date range', () => {
      expect(
        listLoanerBookingsInputSchema.parse({ pageSize: 10, overdueOnly: true }),
      ).toEqual({ pageSize: 10, overdueOnly: true });
      expect(() =>
        listLoanerBookingsInputSchema.parse({
          from: '2026-10-02T00:00:00.000Z',
          to: '2026-10-01T00:00:00.000Z',
        }),
      ).toThrow(ZodError);
    });
  });

  describe('list_estimates', () => {
    it('requires sentFrom and sentTo together', () => {
      expect(() =>
        listEstimatesInputSchema.parse({ sentFrom: '2026-10-01' }),
      ).toThrow(ZodError);
      expect(
        listEstimatesInputSchema.parse({
          sentFrom: '2026-10-01',
          sentTo: '2026-10-31',
          status: 'SENT',
        }),
      ).toMatchObject({ status: 'SENT' });
    });
  });

  describe('list_order_communications', () => {
    it('requires orderId and accepts paging', () => {
      expect(() => listOrderCommunicationsInputSchema.parse({})).toThrow(ZodError);
      expect(
        listOrderCommunicationsInputSchema.parse({
          orderId: ORDER_ID,
          pageSize: 5,
        }),
      ).toEqual({ orderId: ORDER_ID, pageSize: 5 });
    });
  });

  describe('get_check_in', () => {
    it('requires a workshop order id', () => {
      expect(() => getCheckInInputSchema.parse({})).toThrow(ZodError);
      expect(getCheckInInputSchema.parse({ orderId: ORDER_ID })).toEqual({
        orderId: ORDER_ID,
      });
    });
  });

  describe('get_staff_availability', () => {
    it('accepts optional filters and rejects invalid dates', () => {
      expect(getStaffAvailabilityInputSchema.parse({})).toEqual({});
      expect(() =>
        getStaffAvailabilityInputSchema.parse({ date: 'not-a-date' }),
      ).toThrow(ZodError);
    });
  });
});
