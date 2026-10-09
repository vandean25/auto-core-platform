import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Trade-in netting for vehicle sales (AUT-443, phase B).
 *
 * The allowance is the value the dealer credits the buyer for their own car. It reduces the
 * cash billed on the sale invoice and is the purchase price (cost basis) of the trade-in
 * VehiclePurchase. Margin VAT is still computed on the full sale price: the trade-in value is
 * part of the consideration for the sold vehicle (see vehicle-sale.service finalize).
 */

export const TRADE_IN_ALLOWANCE_INVALID = 'TRADE_IN_ALLOWANCE_INVALID';
export const TRADE_IN_VIN_IS_SOLD_VEHICLE = 'TRADE_IN_VIN_IS_SOLD_VEHICLE';
export const TRADE_IN_FIRST_REGISTRATION_INVALID =
  'TRADE_IN_FIRST_REGISTRATION_INVALID';

export function assertTradeInIsNotSoldVehicle(
  tradeInVin: string,
  soldVin: string | null,
): void {
  if (soldVin && soldVin.trim().toUpperCase() === tradeInVin) {
    throw new UnprocessableEntityException({
      code: TRADE_IN_VIN_IS_SOLD_VEHICLE,
      message: 'The trade-in vehicle cannot be the vehicle being sold.',
    });
  }
}

export function assertTradeInFirstRegistrationNotFuture(
  firstRegistrationDate: Date | undefined,
  now: Date,
): void {
  if (
    firstRegistrationDate &&
    firstRegistrationDate.getTime() > now.getTime()
  ) {
    throw new UnprocessableEntityException({
      code: TRADE_IN_FIRST_REGISTRATION_INVALID,
      message: 'Trade-in first registration cannot be in the future.',
    });
  }
}

export function assertValidTradeInAllowance(
  allowance: Prisma.Decimal,
  salePrice: Prisma.Decimal,
): void {
  if (allowance.lte(0)) {
    throw new UnprocessableEntityException({
      code: TRADE_IN_ALLOWANCE_INVALID,
      message: 'Trade-in allowance must be greater than zero.',
    });
  }
  if (allowance.gt(salePrice)) {
    throw new UnprocessableEntityException({
      code: TRADE_IN_ALLOWANCE_INVALID,
      message: 'Trade-in allowance cannot exceed the sale price.',
    });
  }
}

/** Cash amount billed after the trade-in allowance; the full sale price when there is no trade-in. */
export function netAmountDue(
  salePrice: Prisma.Decimal,
  allowance: Prisma.Decimal | null,
): Prisma.Decimal {
  return allowance === null ? salePrice : salePrice.sub(allowance);
}

export function tradeInLineDescription(vehicle: {
  year: number;
  make: string;
  model: string;
  vin: string | null;
}): string {
  return `Trade-in ${vehicle.year} ${vehicle.make} ${vehicle.model} VIN ${vehicle.vin ?? ''}`.trim();
}

export type MarginSaleInvoiceLine = {
  description: string;
  quantity: Prisma.Decimal;
  unit_price: Prisma.Decimal;
  tax_rate: Prisma.Decimal;
  line_total: Prisma.Decimal;
  revenue_group_name: string;
};

/**
 * Invoice lines for a margin-scheme vehicle sale. The trade-in credit is a negative line in the
 * same tax mode and revenue group, so the lines always sum to the amount billed.
 */
export function buildMarginSaleInvoiceLines(input: {
  vehicleDescription: string;
  salePrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  revenueGroupName: string;
  tradeIn: { description: string; allowance: Prisma.Decimal } | null;
}): MarginSaleInvoiceLine[] {
  const lines: MarginSaleInvoiceLine[] = [
    buildLine({
      description: input.vehicleDescription,
      amount: input.salePrice,
      taxRate: input.taxRate,
      revenueGroupName: input.revenueGroupName,
    }),
  ];
  if (input.tradeIn) {
    lines.push(
      buildLine({
        description: input.tradeIn.description,
        amount: input.tradeIn.allowance.negated(),
        taxRate: input.taxRate,
        revenueGroupName: input.revenueGroupName,
      }),
    );
  }
  return lines;
}

function buildLine(input: {
  description: string;
  amount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  revenueGroupName: string;
}): MarginSaleInvoiceLine {
  return {
    description: input.description,
    quantity: new Prisma.Decimal(1),
    unit_price: input.amount,
    tax_rate: input.taxRate,
    line_total: input.amount,
    revenue_group_name: input.revenueGroupName,
  };
}
