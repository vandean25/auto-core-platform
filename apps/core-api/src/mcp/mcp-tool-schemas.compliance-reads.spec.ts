import {
  checkContactPermissionInputSchema,
  listGewaehrleistungDueInputSchema,
  listTyreSetsInputSchema,
  listWarrantyClaimsInputSchema,
} from './mcp-tool-schemas.compliance-reads.js';

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

describe('AUT-605 compliance read input schemas', () => {
  it('accepts a contact permission check', () => {
    expect(
      checkContactPermissionInputSchema.parse({
        customer_id: CUSTOMER_ID,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
      }),
    ).toEqual({
      customer_id: CUSTOMER_ID,
      purpose: 'ORDER_COMMUNICATION',
      channel: 'EMAIL',
    });
  });

  it('accepts only Gewährleistung windows of 30, 60, or 90 days', () => {
    expect(listGewaehrleistungDueInputSchema.parse({})).toEqual({});
    expect(
      listGewaehrleistungDueInputSchema.safeParse({ within_days: 45 }).success,
    ).toBe(false);
  });

  it('accepts tyre set filters and pageSize', () => {
    expect(
      listTyreSetsInputSchema.parse({
        customer_id: CUSTOMER_ID,
        due_for_swap: true,
        pageSize: 5,
      }),
    ).toEqual({
      customer_id: CUSTOMER_ID,
      due_for_swap: true,
      pageSize: 5,
    });
  });

  it('accepts warranty claim list filters', () => {
    expect(
      listWarrantyClaimsInputSchema.parse({
        type: 'KULANZ',
        status: 'DRAFT',
      }),
    ).toEqual({ type: 'KULANZ', status: 'DRAFT' });
  });
});
