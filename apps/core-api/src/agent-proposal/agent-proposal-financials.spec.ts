import { BadRequestException } from '@nestjs/common';
import { resolveLineItemFinancials } from './agent-proposal-financials.js';

describe('resolveLineItemFinancials', () => {
  it('defaults to quantity 1 and zero amounts for an empty payload', () => {
    expect(resolveLineItemFinancials({})).toEqual({
      unitPrice: 0,
      totalAmount: 0,
      quantity: 1,
    });
  });

  it('rejects quantities that are not positive finite numbers', () => {
    for (const quantity of ['2', 0, -1, Infinity, null]) {
      expect(() => resolveLineItemFinancials({ quantity })).toThrow(
        BadRequestException,
      );
    }
    expect(() => resolveLineItemFinancials({ quantity: 0 })).toThrow(
      'Line item quantity must be a positive number',
    );
  });

  it('derives the total from the unit price and quantity', () => {
    expect(resolveLineItemFinancials({ unit_price: 10, quantity: 3 })).toEqual({
      unitPrice: 10,
      totalAmount: 30,
      quantity: 3,
    });
  });

  it('converts cents fields to EUR for both unit price and total', () => {
    expect(resolveLineItemFinancials({ unit_price_cents: 1250 })).toEqual({
      unitPrice: 12.5,
      totalAmount: 12.5,
      quantity: 1,
    });
    expect(
      resolveLineItemFinancials({ amountCents: 2500, quantity: 5 }),
    ).toEqual({ unitPrice: 5, totalAmount: 25, quantity: 5 });
  });

  it('uses the first defined unit price key in declaration order', () => {
    expect(
      resolveLineItemFinancials({ unit_price: 10, unitPrice: 99 }).unitPrice,
    ).toBe(10);
  });

  it('reports invalid and negative values with the field label', () => {
    expect(() => resolveLineItemFinancials({ unit_price_cents: -5 })).toThrow(
      'Line item unit_price cannot be negative',
    );
    expect(() => resolveLineItemFinancials({ amount_cents: 'x' })).toThrow(
      'Line item amount must be a valid number',
    );
    expect(() => resolveLineItemFinancials({ amount: NaN })).toThrow(
      'Line item amount must be a valid number',
    );
  });

  it('rejects a total that contradicts unit price times quantity', () => {
    expect(() =>
      resolveLineItemFinancials({ unit_price: 10, quantity: 2, amount_eur: 25 }),
    ).toThrow(
      'Payload amount (25) contradicts unit_price (10) * quantity (2) = 20',
    );
  });

  it('accepts a total within one cent of unit price times quantity', () => {
    expect(
      resolveLineItemFinancials({ unit_price: 10, amount_eur: 10.005 }),
    ).toEqual({ unitPrice: 10, totalAmount: 10.005, quantity: 1 });
  });
});
