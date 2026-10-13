import { CustomerType } from '@prisma/client';
import {
  formatCustomerName,
  toWorkshopOrderSummary,
} from './agent-proposal-order-summary.js';

const privateCustomer = {
  type: CustomerType.PRIVATE,
  company_name: null,
  first_name: 'Ada',
  last_name: 'Lovelace',
};

const baseOrder = {
  id: 'wo-1',
  order_number: ' WO-2026-0001 ',
  customer: privateCustomer,
  vehicle: { plate: ' W 123 ', year: 2019, make: 'Audi', model: 'A4' },
};

describe('toWorkshopOrderSummary', () => {
  it('maps the order with trimmed display fields', () => {
    expect(toWorkshopOrderSummary(baseOrder)).toEqual({
      id: 'wo-1',
      order_number: 'WO-2026-0001',
      customer_name: 'Ada Lovelace',
      vehicle_registration: 'W 123',
      vehicle_description: '2019 Audi A4',
    });
  });

  it('returns null for blank or missing order and plate values', () => {
    const summary = toWorkshopOrderSummary({
      ...baseOrder,
      order_number: '   ',
      customer: null,
      vehicle: { plate: null, year: 2019, make: ' ', model: '' },
    });

    expect(summary).toEqual({
      id: 'wo-1',
      order_number: null,
      customer_name: null,
      vehicle_registration: null,
      vehicle_description: '2019',
    });
  });
});

describe('formatCustomerName', () => {
  it('uses the company name for company customers', () => {
    expect(
      formatCustomerName({
        type: CustomerType.COMPANY,
        company_name: '  ACME GmbH ',
        first_name: 'Ada',
        last_name: 'Lovelace',
      }),
    ).toBe('ACME GmbH');
  });

  it('falls back to the person name when a company has no name', () => {
    expect(
      formatCustomerName({
        type: CustomerType.COMPANY,
        company_name: '   ',
        first_name: 'Ada',
        last_name: 'Lovelace',
      }),
    ).toBe('Ada Lovelace');
  });

  it('trims the person name and returns null for a missing customer', () => {
    expect(
      formatCustomerName({ ...privateCustomer, last_name: '' }),
    ).toBe('Ada');
    expect(formatCustomerName(null)).toBeNull();
  });
});
