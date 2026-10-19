import { ZodError } from 'zod';
import {
  getStaffAvailabilityInputSchema,
  listEstimatesInputSchema,
  listLoanerBookingsInputSchema,
} from './mcp-read-wave2-schemas.js';

describe('mcp-read-wave2-schemas', () => {
  it('requires sentFrom and sentTo together', () => {
    expect(() =>
      listEstimatesInputSchema.parse({ sentFrom: '2026-10-01' }),
    ).toThrow(ZodError);
  });

  it('accepts list_loaner_bookings paging input', () => {
    expect(
      listLoanerBookingsInputSchema.parse({ pageSize: 10, overdueOnly: true }),
    ).toEqual({ pageSize: 10, overdueOnly: true });
  });

  it('accepts optional staff availability filters', () => {
    expect(getStaffAvailabilityInputSchema.parse({})).toEqual({});
  });
});
