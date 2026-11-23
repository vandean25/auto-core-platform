import { Prisma, TransactionType } from '@prisma/client';

import Decimal = Prisma.Decimal;

const ZERO = new Decimal(0);

export interface ValuationState {
  averageUnitCost: Decimal | null;
  valuedQuantity: Decimal;
}

export interface ValuationBookingInput {
  type: TransactionType;
  quantity: Decimal | number | string;
  costBasis?: Decimal | number | string | null;
}

export interface ValuationStepResult {
  state: ValuationState;
  stampedCostBasis: Decimal | null;
  isUnvaluedGap: boolean;
}

export function roundUnitCost(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function roundQuantity(value: Decimal): Decimal {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

export function computeExtendedValue(
  quantity: Decimal | number | string,
  unitCost: Decimal | number | string,
): Decimal {
  return new Decimal(quantity.toString())
    .mul(new Decimal(unitCost.toString()))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function isTransferTransactionType(type: TransactionType): boolean {
  return (
    type === TransactionType.TRANSFER_IN ||
    type === TransactionType.TRANSFER_OUT
  );
}

export function isOutboundCostStampedType(type: TransactionType): boolean {
  return (
    type === TransactionType.SALE_ISSUE ||
    type === TransactionType.WORKSHOP_CONSUMPTION
  );
}

function toOptionalDecimal(
  value: Decimal | number | string | null | undefined,
): Decimal | null {
  if (value === null || value === undefined) {
    return null;
  }
  return new Decimal(value.toString());
}

/**
 * Pure moving-average (gleitender Durchschnitt) state transition for one ledger booking.
 * - Transfers never change the legal entity's average or valued quantity.
 * - Inbound bookings with a unit cost mix into the average (or restart if valued qty <= 0).
 * - Inbound bookings without a unit cost are reported as gaps and do not invent a cost.
 * - Outbound bookings reduce valued quantity at the current average (clamped at 0, freezing the average)
 *   and stamp SALE_ISSUE / WORKSHOP_CONSUMPTION rows with the current average.
 */
export function applyValuationStep(
  current: ValuationState,
  booking: ValuationBookingInput,
): ValuationStepResult {
  const incomingCost = toOptionalDecimal(booking.costBasis);
  if (isTransferTransactionType(booking.type)) {
    return {
      state: current,
      stampedCostBasis: incomingCost,
      isUnvaluedGap: false,
    };
  }

  const quantity = new Decimal(booking.quantity.toString());
  if (quantity.eq(0)) {
    return {
      state: current,
      stampedCostBasis: incomingCost,
      isUnvaluedGap: false,
    };
  }

  if (quantity.gt(0)) {
    if (incomingCost === null) {
      return {
        state: current,
        stampedCostBasis: null,
        isUnvaluedGap: true,
      };
    }

    const unitCost = roundUnitCost(incomingCost);
    const isRestart =
      current.valuedQuantity.lte(0) || current.averageUnitCost === null;
    const newQty = isRestart
      ? roundQuantity(quantity)
      : roundQuantity(current.valuedQuantity.add(quantity));
    const newAvg = isRestart
      ? unitCost
      : roundUnitCost(
          current.valuedQuantity
            .mul(current.averageUnitCost!)
            .add(quantity.mul(unitCost))
            .div(newQty),
        );

    return {
      state: {
        averageUnitCost: newAvg,
        valuedQuantity: newQty,
      },
      stampedCostBasis: unitCost,
      isUnvaluedGap: false,
    };
  }

  // Outbound (quantity < 0)
  const stampedCostBasis = isOutboundCostStampedType(booking.type)
    ? current.averageUnitCost
    : incomingCost;
  const rawRemaining = current.valuedQuantity.add(quantity);
  const nextQty = rawRemaining.lte(0) ? ZERO : roundQuantity(rawRemaining);

  return {
    state: {
      // Freeze the last average when valued quantity reaches or crosses zero.
      averageUnitCost: current.averageUnitCost,
      valuedQuantity: nextQty,
    },
    stampedCostBasis,
    isUnvaluedGap: current.averageUnitCost === null && incomingCost === null,
  };
}
