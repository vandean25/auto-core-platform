import { PaymentMethod, type Prisma } from '@prisma/client';

export function mapPaymentMethodToFiskaly(
  method: PaymentMethod,
): 'CASH' | 'NON_CASH' {
  return method === PaymentMethod.CASH ? 'CASH' : 'NON_CASH';
}

export function buildNormalSignRequestBody(params: {
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string;
  grossAmount: Prisma.Decimal;
  method: PaymentMethod;
}): Record<string, unknown> {
  const amount = params.grossAmount.toFixed(2);
  const paymentType = mapPaymentMethodToFiskaly(params.method);
  return {
    receipt_type: 'NORMAL',
    schema: {
      standard_v1: {
        amounts_per_vat_rate: [{ vat_rate: 'STANDARD', amount }],
        amounts_per_payment_type: [
          { payment_type: paymentType, amount, currency_code: 'EUR' },
        ],
        line_items: [
          {
            quantity: '1',
            text: `Rechnung ${params.invoiceNumber}`,
            price_per_unit: amount,
          },
        ],
      },
    },
    metadata: {
      acp_invoice_id: params.invoiceId,
      acp_invoice_no: params.invoiceNumber,
      acp_payment_id: params.paymentId,
    },
  };
}

export function buildCancellationSignRequestBody(params: {
  invoiceId: string;
  invoiceNumber: string;
  paymentId: string;
  grossAmount: Prisma.Decimal;
  method: PaymentMethod;
  originalReceiptId: string;
}): Record<string, unknown> {
  const amount = params.grossAmount.negated().toFixed(2);
  const paymentType = mapPaymentMethodToFiskaly(params.method);
  return {
    receipt_type: 'CANCELLATION',
    schema: {
      standard_v1: {
        amounts_per_vat_rate: [{ vat_rate: 'STANDARD', amount }],
        amounts_per_payment_type: [
          { payment_type: paymentType, amount, currency_code: 'EUR' },
        ],
        line_items: [
          {
            quantity: '1',
            text: `Storno Rechnung ${params.invoiceNumber}`,
            price_per_unit: amount,
          },
        ],
      },
    },
    metadata: {
      acp_invoice_id: params.invoiceId,
      acp_invoice_no: params.invoiceNumber,
      acp_payment_id: params.paymentId,
      acp_original_receipt_id: params.originalReceiptId,
    },
  };
}
