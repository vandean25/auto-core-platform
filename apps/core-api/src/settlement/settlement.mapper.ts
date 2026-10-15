import type {
  FiscalReceipt,
  FiscalReceiptState,
  Invoice,
  Payment,
  PaymentStatus,
} from '@prisma/client';

export type FiscalReceiptSummaryDto = {
  id: string;
  providerReceiptId: string;
  receiptType: string;
  state: FiscalReceiptState;
  receiptNumber: string | null;
  timeSignature: number | null;
  cashRegisterSerialNumber: string | null;
  qrCodeData: string | null;
  signed: boolean | null;
  hints: string[] | null;
  providerRequestId: string | null;
};

export type SettlementPaymentSummaryDto = {
  id: string;
  idempotencyKey: string;
  status: PaymentStatus;
  method: string;
  amount: string;
  currency: string;
  externalReceiptNumber: string | null;
  externalReceiptDate: string | null;
  fiscalReceipts: FiscalReceiptSummaryDto[];
};

export type SettlementResponseDto = {
  invoiceId: string;
  invoiceStatus: string;
  rksvMode?: string;
  payment: SettlementPaymentSummaryDto | null;
};

function readSignedField(
  response: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!response) return null;
  return response[key];
}

export function mapFiscalReceiptSummary(
  receipt: FiscalReceipt,
): FiscalReceiptSummaryDto {
  const body = (receipt.response_body ?? null) as Record<
    string,
    unknown
  > | null;
  const hints = readSignedField(body, 'hints');
  return {
    id: receipt.id,
    providerReceiptId: receipt.provider_receipt_id,
    receiptType: receipt.receipt_type,
    state: receipt.state,
    receiptNumber:
      typeof readSignedField(body, 'receipt_number') === 'string'
        ? (readSignedField(body, 'receipt_number') as string)
        : null,
    timeSignature:
      typeof readSignedField(body, 'time_signature') === 'number'
        ? (readSignedField(body, 'time_signature') as number)
        : null,
    cashRegisterSerialNumber:
      typeof readSignedField(body, 'cash_register_serial_number') === 'string'
        ? (readSignedField(body, 'cash_register_serial_number') as string)
        : null,
    qrCodeData:
      typeof readSignedField(body, 'qr_code_data') === 'string'
        ? (readSignedField(body, 'qr_code_data') as string)
        : null,
    signed:
      typeof readSignedField(body, 'signed') === 'boolean'
        ? (readSignedField(body, 'signed') as boolean)
        : null,
    hints: Array.isArray(hints)
      ? hints.filter((entry): entry is string => typeof entry === 'string')
      : null,
    providerRequestId: receipt.provider_request_id,
  };
}

export function mapSettlementResponse(
  invoice: Invoice,
  payment: (Payment & { fiscal_receipts: FiscalReceipt[] }) | null,
  options?: { rksvMode?: string },
): SettlementResponseDto {
  return {
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    rksvMode: options?.rksvMode,
    payment: payment
      ? {
          id: payment.id,
          idempotencyKey: payment.idempotency_key,
          status: payment.status,
          method: payment.method,
          amount: payment.amount.toFixed(2),
          currency: payment.currency,
          externalReceiptNumber: payment.external_receipt_number,
          externalReceiptDate: payment.external_receipt_date
            ? payment.external_receipt_date.toISOString().slice(0, 10)
            : null,
          fiscalReceipts: payment.fiscal_receipts.map(mapFiscalReceiptSummary),
        }
      : null,
  };
}
