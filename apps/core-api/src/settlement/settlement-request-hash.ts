import { createHash } from 'node:crypto';

export function hashSettlementRecordRequest(input: {
  invoiceId: string;
  method: string;
  amount: string;
  currency: string;
  mode: string;
  externalReceiptNumber?: string | null;
  externalReceiptDate?: string | null;
}): string {
  const payload = JSON.stringify({
    invoiceId: input.invoiceId,
    method: input.method,
    amount: input.amount,
    currency: input.currency,
    mode: input.mode,
    externalReceiptNumber: input.externalReceiptNumber ?? null,
    externalReceiptDate: input.externalReceiptDate ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}
