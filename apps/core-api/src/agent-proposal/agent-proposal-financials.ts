import { BadRequestException } from '@nestjs/common';

export interface LineItemFinancials {
  unitPrice: number;
  totalAmount: number;
  quantity: number;
}

/** Accepted payload keys for a unit price, with the divisor that converts each to EUR. */
const UNIT_PRICE_FIELDS: ReadonlyArray<
  readonly [key: string, divisor: number]
> = [
  ['unit_price', 1],
  ['unitPrice', 1],
  ['unit_price_cents', 100],
  ['unitPriceCents', 100],
];

/** Accepted payload keys for a line total, with the divisor that converts each to EUR. */
const AMOUNT_FIELDS: ReadonlyArray<readonly [key: string, divisor: number]> = [
  ['amount_eur', 1],
  ['amountEur', 1],
  ['amount', 1],
  ['amount_cents', 100],
  ['amountCents', 100],
];

export function resolveLineItemFinancials(
  record: Record<string, unknown>,
): LineItemFinancials {
  const quantity = readQuantity(record);
  const unitPrice = readMoneyField(
    record,
    UNIT_PRICE_FIELDS,
    'Line item unit_price',
  );
  const totalAmount = readMoneyField(record, AMOUNT_FIELDS, 'Line item amount');

  if (unitPrice !== undefined && totalAmount !== undefined) {
    const expectedTotal = unitPrice * quantity;
    if (Math.abs(expectedTotal - totalAmount) > 0.01) {
      throw new BadRequestException(
        `Payload amount (${totalAmount}) contradicts unit_price (${unitPrice}) * quantity (${quantity}) = ${expectedTotal}`,
      );
    }
    return { unitPrice, totalAmount, quantity };
  }

  if (unitPrice !== undefined) {
    return {
      unitPrice,
      totalAmount: unitPrice * quantity,
      quantity,
    };
  }

  if (totalAmount !== undefined) {
    return {
      unitPrice: totalAmount / quantity,
      totalAmount,
      quantity,
    };
  }

  return {
    unitPrice: 0,
    totalAmount: 0,
    quantity,
  };
}

function readQuantity(record: Record<string, unknown>): number {
  if (record.quantity === undefined) {
    return 1;
  }
  if (
    typeof record.quantity !== 'number' ||
    !Number.isFinite(record.quantity) ||
    record.quantity <= 0
  ) {
    throw new BadRequestException(
      'Line item quantity must be a positive number',
    );
  }
  return record.quantity;
}

/**
 * First defined field wins. Validation runs on the raw payload value, so
 * cents fields report the same messages as their EUR counterparts.
 */
function readMoneyField(
  record: Record<string, unknown>,
  fields: ReadonlyArray<readonly [key: string, divisor: number]>,
  label: string,
): number | undefined {
  for (const [key, divisor] of fields) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`${label} must be a valid number`);
    }
    if (value < 0) {
      throw new BadRequestException(`${label} cannot be negative`);
    }
    return value / divisor;
  }
  return undefined;
}
