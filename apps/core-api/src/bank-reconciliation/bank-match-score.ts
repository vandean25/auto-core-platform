import type { BankTransaction, Prisma } from '@prisma/client';

export const BANK_MATCH_REASON = {
  AMOUNT_EXACT: 'AMOUNT_EXACT',
  INVOICE_NO_IN_REFERENCE: 'INVOICE_NO_IN_REFERENCE',
  IBAN_SEEN_BEFORE: 'IBAN_SEEN_BEFORE',
  NAME_SIMILAR: 'NAME_SIMILAR',
} as const;

type ReasonCode = (typeof BANK_MATCH_REASON)[keyof typeof BANK_MATCH_REASON];
type MatchReason = { code: ReasonCode; value: string };
type Candidate = { number: string; name: string; outstanding: Prisma.Decimal };
type TransferEvidence = Pick<
  BankTransaction,
  'reference_text' | 'remitter_name' | 'remitter_iban_last4'
> & { availableAmount: Prisma.Decimal };

const WEIGHTS: Record<ReasonCode, number> = {
  AMOUNT_EXACT: 20,
  INVOICE_NO_IN_REFERENCE: 60,
  IBAN_SEEN_BEFORE: 15,
  NAME_SIMILAR: 5,
};

function normalizedName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .sort()
    .join(' ');
}

function hasInvoiceReference(reference: string, number: string): boolean {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}/-])${escaped}(?:$|[^\\p{L}\\p{N}/-])`,
    'iu',
  ).test(reference);
}

export function scoreBankMatch(
  transfer: TransferEvidence,
  candidate: Candidate,
  knownIban: boolean,
) {
  const reasons: MatchReason[] = [];
  if (transfer.availableAmount.equals(candidate.outstanding)) {
    reasons.push({
      code: BANK_MATCH_REASON.AMOUNT_EXACT,
      value: transfer.availableAmount.toFixed(2),
    });
  }
  if (
    candidate.number &&
    hasInvoiceReference(transfer.reference_text ?? '', candidate.number)
  ) {
    reasons.push({
      code: BANK_MATCH_REASON.INVOICE_NO_IN_REFERENCE,
      value: candidate.number,
    });
  }
  if (knownIban && transfer.remitter_iban_last4) {
    reasons.push({
      code: BANK_MATCH_REASON.IBAN_SEEN_BEFORE,
      value: transfer.remitter_iban_last4,
    });
  }
  if (
    candidate.name &&
    transfer.remitter_name &&
    normalizedName(candidate.name) === normalizedName(transfer.remitter_name)
  ) {
    reasons.push({
      code: BANK_MATCH_REASON.NAME_SIMILAR,
      value: candidate.name,
    });
  }
  return {
    score: reasons.reduce((score, reason) => score + WEIGHTS[reason.code], 0),
    reasons,
  };
}
