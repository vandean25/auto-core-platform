import {
  CreditNoteStatus,
  PaymentStatus,
  Prisma,
  type BankTransaction,
} from '@prisma/client';
import { computeInvoiceBalance } from '../finance/receivables/invoice-balance.js';

export function bankOutstanding(
  gross: Prisma.Decimal,
  finalizedCredits: readonly Prisma.Decimal[],
  settledPayments: readonly Prisma.Decimal[],
): Prisma.Decimal {
  return computeInvoiceBalance({
    total_gross: gross,
    credit_notes: finalizedCredits.map((total_gross) => ({
      status: CreditNoteStatus.FINALIZED,
      total_gross,
    })),
    payments: settledPayments.map((amount) => ({
      status: PaymentStatus.SETTLED,
      amount,
    })),
  }).outstanding;
}

export function isAllocatableCredit(
  transfer: Pick<BankTransaction, 'currency' | 'is_credit' | 'amount'>,
): boolean {
  return (
    transfer.currency === 'EUR' && transfer.is_credit && transfer.amount.gt(0)
  );
}
