import { Prisma, type BankTransaction } from '@prisma/client';

export function bankOutstanding(
  gross: Prisma.Decimal,
  finalizedCredits: readonly Prisma.Decimal[],
  settledPayments: readonly Prisma.Decimal[],
): Prisma.Decimal {
  return Prisma.Decimal.max(
    0,
    [...finalizedCredits, ...settledPayments].reduce(
      (balance, amount) => balance.minus(amount),
      gross,
    ),
  );
}

export function isAllocatableCredit(
  transfer: Pick<BankTransaction, 'currency' | 'is_credit' | 'amount'>,
): boolean {
  return (
    transfer.currency === 'EUR' && transfer.is_credit && transfer.amount.gt(0)
  );
}
