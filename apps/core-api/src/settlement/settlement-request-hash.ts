import { createHash } from 'node:crypto';

export function hashSettlementRecordRequest(input: {
  invoiceId: string;
  method: string;
  externalReceiptNumber?: string | null;
  externalReceiptDate?: string | null;
}): string {
  const payload = JSON.stringify({
    invoiceId: input.invoiceId,
    method: input.method,
    externalReceiptNumber: input.externalReceiptNumber ?? null,
    externalReceiptDate: input.externalReceiptDate ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function hashSettlementReconcileRequest(input: {
  invoiceId: string;
  idempotencyKey: string;
}): string {
  const payload = JSON.stringify(input);
  return createHash('sha256').update(payload).digest('hex');
}
