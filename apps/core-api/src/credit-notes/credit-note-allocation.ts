import { Prisma } from '@prisma/client';

export type OriginalLineSnapshot = {
  id: string;
  quantity: Prisma.Decimal;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
};

export type PriorCreditLine = {
  originalItemId: string;
  quantity: Prisma.Decimal;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
};

export type LineBalance = {
  quantity: Prisma.Decimal;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
};

export type AllocatedLineAmounts = LineBalance;

const zero = () => new Prisma.Decimal(0);

function sumPriorForLine(
  priorCredits: PriorCreditLine[],
  originalItemId: string,
): LineBalance {
  const matches = priorCredits.filter(
    (line) => line.originalItemId === originalItemId,
  );
  return {
    quantity: matches.reduce((sum, line) => sum.add(line.quantity), zero()),
    net: matches.reduce((sum, line) => sum.add(line.net), zero()),
    tax: matches.reduce((sum, line) => sum.add(line.tax), zero()),
    gross: matches.reduce((sum, line) => sum.add(line.gross), zero()),
  };
}

export function computeRemainingLineBalances(
  originalLines: OriginalLineSnapshot[],
  priorCredits: PriorCreditLine[],
): Map<string, LineBalance> {
  const remaining = new Map<string, LineBalance>();

  for (const original of originalLines) {
    const credited = sumPriorForLine(priorCredits, original.id);
    remaining.set(original.id, {
      quantity: original.quantity.sub(credited.quantity),
      net: original.net.sub(credited.net),
      tax: original.tax.sub(credited.tax),
      gross: original.gross.sub(credited.gross),
    });
  }

  return remaining;
}

export function allocateCreditLineAmounts(input: {
  original: OriginalLineSnapshot;
  creditQuantity: Prisma.Decimal;
  priorCredits: PriorCreditLine[];
}): AllocatedLineAmounts {
  const { original, creditQuantity, priorCredits } = input;
  const credited = sumPriorForLine(priorCredits, original.id);
  const remaining = {
    quantity: original.quantity.sub(credited.quantity),
    net: original.net.sub(credited.net),
    tax: original.tax.sub(credited.tax),
    gross: original.gross.sub(credited.gross),
  };

  if (creditQuantity.lte(0) || creditQuantity.gt(remaining.quantity)) {
    throw new Error('Credit quantity exceeds remaining balance');
  }

  if (creditQuantity.eq(remaining.quantity)) {
    return remaining;
  }

  const net = original.net
    .mul(creditQuantity)
    .div(original.quantity)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const tax = original.tax
    .mul(creditQuantity)
    .div(original.quantity)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const gross = original.gross
    .mul(creditQuantity)
    .div(original.quantity)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return { quantity: creditQuantity, net, tax, gross };
}
